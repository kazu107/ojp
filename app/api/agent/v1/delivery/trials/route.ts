import { agentHandler, agentJson, readAgentJson } from "@/lib/delivery-agent-api";
import { agentUuid, enqueueAgentDeliveryTrial, requireDeliveryAgent } from "@/lib/delivery-agent-store";
import { DeliveryError } from "@/lib/delivery-store";

export async function POST(request: Request) {
  return agentHandler(async () => {
    const principal = await requireDeliveryAgent(request, "delivery:trial");
    const requestKey = request.headers.get("idempotency-key");
    if (!agentUuid(requestKey)) throw new DeliveryError("Agent trial requires a UUID idempotency key");
    const trial = await enqueueAgentDeliveryTrial(principal, await readAgentJson(request), requestKey);
    return agentJson({ ...trial, resultPath: "/api/agent/v1/delivery/trials/" + trial.id }, 202, { "Retry-After": "2" });
  });
}
