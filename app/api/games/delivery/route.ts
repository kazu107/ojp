import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-response";
import { allowsGamePreviewOrigin } from "@/lib/grid-game-preview";
import { getCurrentUser } from "@/lib/store";
import {
  DeliveryError, deliveryEnabled, enqueueDeliveryTrial, registerDeliveryBot,
  retryDeliveryEvaluation, startDeliveryEvaluation, withdrawDeliveryBot,
} from "@/lib/delivery-store";

const BODY_LIMIT = 400 * 1024;

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json" || !request.body)
    throw new DeliveryError("Invalid delivery request");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "", size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > BODY_LIMIT) throw new DeliveryError("Delivery request is too large", 413);
      text += decoder.decode(value, { stream: true });
    }
    const body: unknown = JSON.parse(text + decoder.decode());
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new DeliveryError("Invalid delivery request");
    return body as Record<string, unknown>;
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof DeliveryError) throw error;
    throw new DeliveryError("Invalid delivery request");
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  try {
    if (!deliveryEnabled()) throw new DeliveryError("Delivery arena is disabled", 404);
    if (!allowsGamePreviewOrigin(request.headers.get("origin"), request.url, process.env.AUTH_URL || process.env.NEXTAUTH_URL))
      throw new DeliveryError("Cross-origin delivery requests are not allowed", 403);
    const user = await getCurrentUser();
    if (user.status !== "active") throw new DeliveryError("User account is not active", 403);
    const body = await readBody(request);
    const reply = (data: object, status = 200) => NextResponse.json(data, {
      status, headers: { "Cache-Control": "private, no-store" },
    });
    switch (body.action) {
      case "trial": return reply(await enqueueDeliveryTrial(user.id, body), 202);
      case "register": return reply(await registerDeliveryBot(user.id, body.name, body), 201);
      case "withdraw":
        await withdrawDeliveryBot(user.id);
        return reply({ ok: true });
      case "start":
        if (user.role !== "admin") throw new DeliveryError("Administrator access is required", 403);
        return reply({ evaluation: await startDeliveryEvaluation("manual") }, 202);
      case "retry":
        if (user.role !== "admin") throw new DeliveryError("Administrator access is required", 403);
        if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/.test(body.id))
          throw new DeliveryError("Invalid delivery request");
        await retryDeliveryEvaluation(body.id);
        return reply({ ok: true }, 202);
      default: throw new DeliveryError("Invalid delivery request");
    }
  } catch (error) {
    if (error instanceof DeliveryError)
      return NextResponse.json({ error: error.message }, { status: error.status });
    return errorResponse(error, "Unable to process delivery request");
  }
}
