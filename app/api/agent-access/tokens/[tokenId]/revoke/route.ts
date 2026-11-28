import { agentHandler, agentJson, requireAgentBrowserOwner } from "@/lib/delivery-agent-api";
import { agentUuid, revokeAgentAccessToken } from "@/lib/delivery-agent-store";
import { DeliveryError } from "@/lib/delivery-store";

export async function POST(request: Request, { params }: { params: Promise<{ tokenId: string }> }) {
  return agentHandler(async () => {
    const owner = await requireAgentBrowserOwner(request);
    const { tokenId } = await params;
    if (!agentUuid(tokenId)) throw new DeliveryError("Agent token not found", 404);
    await revokeAgentAccessToken(owner, tokenId);
    return agentJson({ ok: true });
  }, false);
}
