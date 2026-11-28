import { agentHandler, agentJson } from "@/lib/delivery-agent-api";
import { requireDeliveryAgent } from "@/lib/delivery-agent-store";
import { DELIVERY_CAPACITY, DELIVERY_TURNS } from "@/lib/delivery-game";
import { DELIVERY_PYTHON_TEMPLATE } from "@/lib/delivery-templates";
import { SUBMISSION_LANGUAGES } from "@/lib/languages";

export async function GET(request: Request) {
  return agentHandler(async () => {
    await requireDeliveryAgent(request, "delivery:read");
    return agentJson({
      id: "delivery", title: "Delivery Duel", width: 15, height: 15, turns: DELIVERY_TURNS, capacity: DELIVERY_CAPACITY,
      languages: SUBMISSION_LANGUAGES, starter: { language: "python", sourceCode: DELIVERY_PYTHON_TEMPLATE },
      protocol: {
        header: ["turn", "seat", "H", "W", "x", "y", "opponentX", "opponentY", "load", "scoreA", "scoreB", "N"],
        orders: ["id", "pickupX", "pickupY", "dropoffX", "dropoffY", "deadline", "base", "size", "owner"],
        input: "Read one space-separated header, H grid rows (. or #), then N space-separated order rows. Coordinates start at 0,0 in the top left. Seats are 0 and 1; owner -1 means unclaimed. Stop on END.",
        actions: ["UP", "DOWN", "LEFT", "RIGHT", "WAIT", "PICKUP id", "DELIVER id"],
        output: "Write exactly one action with a newline per turn and flush it. A well-formed but inapplicable action becomes WAIT.",
        scoring: "Delivery by the deadline earns base plus min(20, 2*(deadline-turn)). An expired carried order costs base. Both bots see the board before acting; contested pickup priority alternates.",
      },
      trial: { seed: 11, opponent: "standard delivery bot", ranked: false, minimumIntervalSeconds: 30 },
    });
  });
}
