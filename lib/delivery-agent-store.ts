import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AgentAccessToken, Prisma } from "@prisma/client";
import { prisma } from "./db/prisma";
import { isWellFormedText } from "./board-visualization";
import { DELIVERY_TURNS, type DeliveryResult } from "./delivery-game";
import {
  DeliveryError, deliveryEnabled, deliverySourceDigest, enqueueDeliveryTrial,
  parseDeliveryBotName, parseDeliveryBotSource, registerDeliveryBotLocked, withDeliveryLock,
} from "./delivery-store";
import { isActiveAgentOwner } from "./store";

const TOKEN_PREFIX = "ojp_agent_v1_";
const TOKEN_TTL_MS = 30 * 24 * 3600_000;
const DRAFT_TTL_MS = 15 * 60_000;
const HOUR_MS = 3600_000;
export const deliveryAgentEnabled = () => deliveryEnabled() && process.env.DELIVERY_AGENT_ENABLED === "1";
export function assertDeliveryAgentEnabled() {
  if (!deliveryAgentEnabled()) throw new DeliveryError("Agent integration is disabled", 404);
}
export type AgentScope = "delivery:read" | "delivery:trial" | "delivery:prepare";
const BASIC_SCOPES: AgentScope[] = ["delivery:read", "delivery:trial"];
const tokenFields = { id: true, label: true, scopes: true, createdAt: true, expiresAt: true, revokedAt: true } as const;

export function agentUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

function tokenDigest(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

async function requireActiveOwner(ownerId: string) {
  if (!await isActiveAgentOwner(ownerId)) throw new DeliveryError("User account is not active", 403);
}

export async function createAgentAccessToken(ownerId: string, label: unknown, allowDrafts: unknown) {
  assertDeliveryAgentEnabled();
  if (typeof label !== "string" || !label.trim() || label.length > 40 || !isWellFormedText(label) ||
      Array.from(label).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
      typeof allowDrafts !== "boolean") throw new DeliveryError("Invalid agent token settings");
  await requireActiveOwner(ownerId);
  return withDeliveryLock(async tx => {
    const now = new Date();
    if (await tx.agentAccessToken.count({ where: { ownerId, revokedAt: null, expiresAt: { gt: now } } }) >= 5)
      throw new DeliveryError("At most five active agent tokens are allowed", 409);
    if (await tx.agentAccessToken.count({ where: { ownerId, createdAt: { gte: new Date(now.getTime() - HOUR_MS) } } }) >= 12)
      throw new DeliveryError("Too many agent tokens created recently", 429);
    const secret = TOKEN_PREFIX + randomBytes(32).toString("base64url");
    const token = await tx.agentAccessToken.create({ data: { id: randomUUID(), ownerId, label: label.trim(),
      digest: tokenDigest(secret), scopes: allowDrafts ? [...BASIC_SCOPES, "delivery:prepare"] : BASIC_SCOPES,
      createdAt: now, expiresAt: new Date(now.getTime() + TOKEN_TTL_MS) }, select: tokenFields });
    return { secret, token };
  });
}

export async function listAgentAccessTokens(ownerId: string) {
  assertDeliveryAgentEnabled();
  return prisma.agentAccessToken.findMany({ where: { ownerId }, select: tokenFields, orderBy: { createdAt: "desc" }, take: 50 });
}

export async function revokeAgentAccessToken(ownerId: string, id: string) {
  assertDeliveryAgentEnabled();
  await requireActiveOwner(ownerId);
  await withDeliveryLock(async tx => {
    const changed = await tx.agentAccessToken.updateMany({ where: { id, ownerId }, data: { revokedAt: new Date() } });
    if (!changed.count) throw new DeliveryError("Agent token not found", 404);
    await tx.agentDeliveryDraft.updateMany({ where: { ownerId, tokenId: id, appliedAt: null }, data: { sourceCode: null } });
  });
}

type AgentPrincipal = Pick<AgentAccessToken, "id" | "ownerId" | "scopes" | "expiresAt" | "revokedAt">;
const principalFields = { id: true, ownerId: true, scopes: true, expiresAt: true, revokedAt: true } as const;

function checkToken(token: AgentPrincipal | null, scope: AgentScope): AgentPrincipal {
  if (!token || token.revokedAt || token.expiresAt <= new Date()) throw new DeliveryError("Invalid or expired agent token", 401);
  if (!token.scopes.includes(scope)) throw new DeliveryError("Agent token does not allow this action", 403);
  return token;
}

export async function requireDeliveryAgent(request: Request, scope: AgentScope) {
  assertDeliveryAgentEnabled();
  const credentials = /^Bearer (ojp_agent_v1_[A-Za-z0-9_-]{43})$/i.exec(request.headers.get("authorization") ?? "");
  if (!credentials) throw new DeliveryError("Invalid or expired agent token", 401);
  const token = checkToken(await prisma.agentAccessToken.findUnique({
    where: { digest: tokenDigest(credentials[1]) }, select: principalFields,
  }), scope);
  await requireActiveOwner(token.ownerId);
  return token;
}

async function checkTokenLocked(tx: Prisma.TransactionClient, tokenId: string, ownerId: string, scope: AgentScope) {
  return checkToken(await tx.agentAccessToken.findFirst({ where: { id: tokenId, ownerId }, select: principalFields }), scope);
}

export async function enqueueAgentDeliveryTrial(principal: AgentPrincipal, body: unknown, requestKey: string) {
  return enqueueDeliveryTrial(principal.ownerId, body, { requestKey, authorize: async tx => {
    await checkTokenLocked(tx, principal.id, principal.ownerId, "delivery:trial");
  } });
}

export async function getAgentDeliveryTrial(ownerId: string, id: string) {
  const row = await prisma.deliveryMatch.findFirst({ where: { id, ownerId, evaluationId: null },
    select: { id: true, status: true, createdAt: true, finishedAt: true, result: true } });
  if (!row) throw new DeliveryError("Trial not found", 404);
  const r = row.result as unknown as DeliveryResult | null;
  const last = r?.frames.at(-1);
  return { id: row.id, status: row.status, createdAt: row.createdAt, finishedAt: row.finishedAt,
    replayPath: "/games/delivery/matches/" + id,
    result: r && last ? { turns: last.turn, outcome: r.outcome, winner: r.winner, totals: r.totals,
      delivered: last.couriers.map(c => c.delivered), penalties: last.couriers.map(c => c.penalty), faults: r.faults,
      timing: r.timing ?? null } : null };
}

export async function prepareAgentDeliveryDraft(principal: AgentPrincipal, trialId: string, name: unknown, body: unknown) {
  assertDeliveryAgentEnabled();
  const ownerId = principal.ownerId;
  const source = parseDeliveryBotSource(body), label = parseDeliveryBotName(name);
  const sourceDigest = deliverySourceDigest(source);
  return withDeliveryLock(async tx => {
    const token = await checkTokenLocked(tx, principal.id, ownerId, "delivery:prepare");
    const now = new Date();
    const checked = await tx.agentDeliveryTrial.findFirst({ where: { id: trialId, ownerId } });
    if (!checked) throw new DeliveryError("Trial not found", 404);
    if (checked.sourceDigest !== sourceDigest) throw new DeliveryError("Draft code does not match the tested trial", 409);
    const trial = await tx.deliveryMatch.findFirst({ where: { id: trialId, ownerId, evaluationId: null, status: "completed" },
      select: { result: true } });
    const r = trial?.result as unknown as DeliveryResult | null;
    if (!r || r.faults[0] || r.frames.at(-1)?.turn !== DELIVERY_TURNS)
      throw new DeliveryError("Draft requires a completed trial without a bot fault", 409);
    await tx.agentDeliveryDraft.updateMany({ where: { ownerId, expiresAt: { lte: now }, sourceCode: { not: null } },
      data: { sourceCode: null } });
    if (await tx.agentDeliveryDraft.count({ where: { ownerId, appliedAt: null, sourceCode: { not: null }, expiresAt: { gt: now } } }) >= 5)
      throw new DeliveryError("At most five pending agent drafts are allowed", 409);
    if (await tx.agentDeliveryDraft.count({ where: { ownerId, createdAt: { gte: new Date(now.getTime() - HOUR_MS) } } }) >= 20)
      throw new DeliveryError("Too many agent drafts created recently", 429);
    const current = await tx.deliveryBotVersion.findFirst({ where: { userId: ownerId, validUntil: null }, select: { id: true } });
    const draft = await tx.agentDeliveryDraft.create({
      data: { id: randomUUID(), ownerId, tokenId: token.id, trialId, baselineVersionId: current?.id ?? null,
        ...source, name: label, sourceDigest, createdAt: now, expiresAt: new Date(Math.min(now.getTime() + DRAFT_TTL_MS, +token.expiresAt)) },
      select: { id: true, expiresAt: true, sourceDigest: true },
    });
    return { ...draft, reviewPath: "/games/delivery/drafts/" + draft.id };
  });
}

export async function getAgentDraftForReview(ownerId: string, id: string) {
  assertDeliveryAgentEnabled();
  const draft = await prisma.agentDeliveryDraft.findFirst({ where: { id, ownerId } });
  if (!draft) return null;
  const current = await prisma.deliveryBotVersion.findFirst({ where: { userId: ownerId, validUntil: null },
    select: { id: true, name: true, language: true, sourceCode: true } });
  return { id: draft.id, name: draft.name, language: draft.language, trialId: draft.trialId,
    sourceCode: draft.expiresAt > new Date() ? draft.sourceCode : null, sourceDigest: draft.sourceDigest,
    expiresAt: draft.expiresAt, appliedAt: draft.appliedAt, current,
    stale: draft.baselineVersionId !== (current?.id ?? null) };
}

export async function listAgentDrafts(ownerId: string) {
  assertDeliveryAgentEnabled();
  return prisma.agentDeliveryDraft.findMany({
    where: { ownerId, appliedAt: null, sourceCode: { not: null }, expiresAt: { gt: new Date() } },
    select: { id: true, name: true, language: true, expiresAt: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
}

export async function approveAgentDeliveryDraft(ownerId: string, id: string, digest: unknown) {
  assertDeliveryAgentEnabled();
  await requireActiveOwner(ownerId);
  return withDeliveryLock(async tx => {
    const draft = await tx.agentDeliveryDraft.findFirst({ where: { id, ownerId } });
    if (!draft) throw new DeliveryError("Agent draft not found", 404);
    if (digest !== draft.sourceDigest) throw new DeliveryError("The reviewed code digest does not match", 409);
    if (draft.appliedVersionId) return { versionId: draft.appliedVersionId };
    if (!draft.sourceCode || draft.expiresAt <= new Date()) throw new DeliveryError("Agent draft is no longer available", 410);
    await checkTokenLocked(tx, draft.tokenId, ownerId, "delivery:prepare");
    const current = await tx.deliveryBotVersion.findFirst({ where: { userId: ownerId, validUntil: null }, select: { id: true } });
    if ((current?.id ?? null) !== draft.baselineVersionId) throw new DeliveryError("The registered bot changed after this draft was prepared", 409);
    const source = parseDeliveryBotSource(draft);
    if (deliverySourceDigest(source) !== draft.sourceDigest) throw new DeliveryError("The reviewed code digest does not match", 409);
    const version = await registerDeliveryBotLocked(tx, ownerId, draft.name, source);
    await tx.agentDeliveryDraft.update({ where: { id }, data: { appliedVersionId: version.id, appliedAt: new Date(), sourceCode: null } });
    return { versionId: version.id };
  });
}
