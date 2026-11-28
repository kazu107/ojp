import { agentHandler, agentJson, readAgentJson, requireAgentBrowserOwner } from "@/lib/delivery-agent-api";
import { agentUuid, approveAgentDeliveryDraft } from "@/lib/delivery-agent-store";
import { DeliveryError } from "@/lib/delivery-store";

export async function POST(request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  return agentHandler(async () => {
    const owner = await requireAgentBrowserOwner(request);
    const { draftId } = await params;
    if (!agentUuid(draftId)) throw new DeliveryError("Agent draft not found", 404);
    const body = await readAgentJson(request);
    return agentJson(await approveAgentDeliveryDraft(owner, draftId, body.sourceDigest));
  }, false);
}
