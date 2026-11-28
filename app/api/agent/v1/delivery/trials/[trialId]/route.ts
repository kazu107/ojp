import { agentHandler, agentJson } from "@/lib/delivery-agent-api";
import { agentUuid, getAgentDeliveryTrial, requireDeliveryAgent } from "@/lib/delivery-agent-store";
import { DeliveryError } from "@/lib/delivery-store";

export async function GET(request: Request, { params }: { params: Promise<{ trialId: string }> }) {
  return agentHandler(async () => {
    const principal = await requireDeliveryAgent(request, "delivery:read");
    const { trialId } = await params;
    if (!agentUuid(trialId)) throw new DeliveryError("Trial not found", 404);
    const result = await getAgentDeliveryTrial(principal.ownerId, trialId);
    const pending = result.status === "queued" || result.status === "running";
    return agentJson(result, 200, pending ? { "Retry-After": "2" } : {});
  });
}
