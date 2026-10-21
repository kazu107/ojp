import { getJudgeProcessMode, startDedicatedJudgeWorkerLoop } from "../lib/store";
import { assertJudgeSandboxReady } from "../lib/judge-process";
import { getJudgeSandboxMode } from "../lib/judge-sandbox";

async function main() {
  const mode = getJudgeProcessMode();
  if (mode !== "worker") {
    console.log(`[judge-worker] JUDGE_PROCESS_MODE=${mode}; worker loop is disabled.`);
    return;
  }

  await assertJudgeSandboxReady();
  console.log(`[judge-worker] starting dedicated judge worker loop (sandbox=${getJudgeSandboxMode()})`);
  await startDedicatedJudgeWorkerLoop();

  await new Promise(() => {
    // Keep the worker dyno alive.
  });
}

main().catch((error) => {
  console.error("[judge-worker] fatal error:", error);
  process.exit(1);
});
