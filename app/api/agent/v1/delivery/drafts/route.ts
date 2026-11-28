import { agentHandler, agentJson, readAgentJson } from "@/lib/delivery-agent-api";
import { agentUuid, prepareAgentDeliveryDraft, requireDeliveryAgent } from "@/lib/delivery-agent-store";
import { DeliveryError } from "@/lib/delivery-store";

export async function POST(request: Request) {
  return agentHandler(async () => {
    const principal = await requireDeliveryAgent(request, "delivery:prepare");
    const body = await readAgentJson(request);
    if (!agentUuid(body.trialId)) throw new DeliveryError("Invalid agent trial ID");
    return agentJson(await prepareAgentDeliveryDraft(principal, body.trialId, body.name, body), 201);
  });
}
