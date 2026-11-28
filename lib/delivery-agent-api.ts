import { NextResponse } from "next/server";
import { assertDeliveryAgentEnabled } from "./delivery-agent-store";
import { DeliveryError } from "./delivery-store";
import { getCurrentUser, HttpError, isActiveAgentOwner } from "./store";
import { allowsGamePreviewOrigin } from "./grid-game-preview";

const BODY_LIMIT = 400 * 1024;

export function agentJson(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...extra, "Cache-Control": "private, no-store" } });
}

export async function agentHandler(fn: () => Promise<Response>, bearer = true) {
  try {
    assertDeliveryAgentEnabled();
    return await fn();
  } catch (error) {
    if (error instanceof DeliveryError || error instanceof HttpError) {
      const headers: Record<string, string> = {};
      if (bearer && error.status === 401) headers["WWW-Authenticate"] = 'Bearer realm="OJP Delivery"';
      if (error.status === 429) headers["Retry-After"] = "30";
      return agentJson({ error: error.message }, error.status, headers);
    }
    // Unexpected request failures must not log credentials or request bodies.
    console.error("[delivery-agent] Request failed");
    return agentJson({ error: "Agent integration request failed" }, 500);
  }
}

export async function readAgentJson(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json" || !request.body)
    throw new DeliveryError("Agent requests require JSON");
  const reader = request.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0, input = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > BODY_LIMIT) {
        await reader.cancel().catch(() => undefined);
        throw new DeliveryError("Agent request is too large", 413);
      }
      input += decoder.decode(value, { stream: true });
    }
    const data: unknown = JSON.parse(input + decoder.decode());
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new DeliveryError("Invalid agent request");
    return data as Record<string, unknown>;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof DeliveryError) throw error;
    throw new DeliveryError("Invalid agent request");
  } finally { reader.releaseLock(); }
}

export async function requireAgentBrowserOwner(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || !allowsGamePreviewOrigin(origin, request.url, process.env.AUTH_URL || process.env.NEXTAUTH_URL))
    throw new DeliveryError("Agent console requires a same-origin browser request", 403);
  if (request.headers.has("authorization")) throw new DeliveryError("Agent console requires browser sign-in", 401);
  const user = await getCurrentUser();
  if (!await isActiveAgentOwner(user.id)) throw new DeliveryError("User account is not active", 403);
  return user.id;
}
