import { agentHandler, agentJson, readAgentJson, requireAgentBrowserOwner } from "@/lib/delivery-agent-api";
import { createAgentAccessToken } from "@/lib/delivery-agent-store";

export async function POST(request: Request) {
  return agentHandler(async () => {
    const owner = await requireAgentBrowserOwner(request);
    const body = await readAgentJson(request);
    return agentJson(await createAgentAccessToken(owner, body.label, body.allowDrafts), 201);
  }, false);
}
