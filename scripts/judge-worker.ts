import { getJudgeProcessMode, startDedicatedJudgeWorkerLoop } from "../lib/store";

async function main() {
  const mode = getJudgeProcessMode();
  if (mode !== "worker") {
    console.log(`[judge-worker] JUDGE_PROCESS_MODE=${mode}; worker loop is disabled.`);
    return;
  }

  console.log("[judge-worker] starting dedicated judge worker loop");
  await startDedicatedJudgeWorkerLoop();

  await new Promise(() => {
    // Keep the worker dyno alive.
  });
}

main().catch((error) => {
  console.error("[judge-worker] fatal error:", error);
  process.exit(1);
});
