"use client";
import { useEffect, useMemo, useState } from "react";
import type { HeuristicConfig } from "@/lib/heuristic-config";
import { parseBoardReplay, type BoardReplay } from "@/lib/board-visualization";
import type { Language } from "@/lib/types";
import { BoardPlayer } from "./board-visualizer";
import { useI18n } from "./i18n-provider";

interface PreviewJob {
  id: string;
  status: string;
  error?: string | null;
  result?: {
    testResults: Array<{
      boardReplay?: BoardReplay;
      scorerDiagnostic?: string;
      message?: string;
    }>;
  } | null;
}
export function GamePreview({
  problemId,
  contestId,
  config,
  sampleInput,
  sourceCode,
  language,
}: {
  problemId: string;
  contestId?: string | null;
  config: HeuristicConfig;
  sampleInput: string;
  sourceCode: string;
  language: Language;
}) {
  const { t } = useI18n();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (mounted) setReady(true);
    });
    return () => {
      mounted = false;
    };
  }, []);
  const [input, setInput] = useState(sampleInput.slice(0, 8193)),
    [job, setJob] = useState<PreviewJob | null>(null),
    [error, setError] = useState(""),
    [creating, setCreating] = useState(false),
    [lastCode, setLastCode] = useState(""),
    [lastInput, setLastInput] = useState("");
  const jobId = job?.id,
    finished = job?.status === "completed" || job?.status === "failed";
  useEffect(() => {
    if (!jobId || finished) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>,
      cancelled = false;
    const started = Date.now();
    const poll = async () => {
      try {
        const response = await fetch(
          `/api/package-jobs/${encodeURIComponent(jobId)}`,
          { signal: abort.signal, cache: "no-store" },
        );
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error ?? "Unable to load game preview");
        if (cancelled) return;
        setJob(body.job);
        if (body.job.status === "completed" || body.job.status === "failed")
          return;
        if (Date.now() - started > 180000)
          throw new Error("Game preview is still running; retry later");
        timer = setTimeout(poll, 1200);
      } catch (error) {
        if (!cancelled)
          setError(
            error instanceof Error
              ? error.message
              : "Unable to load game preview",
          );
      }
    };
    timer = setTimeout(poll, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      abort.abort();
    };
  }, [jobId, finished]);
  const replay = job?.result?.testResults.find(
    (result) => result.boardReplay,
  )?.boardReplay;
  const initial = useMemo(() => {
    try {
      return config.board ? parseBoardReplay(input, "", config.board) : null;
    } catch {
      return null;
    }
  }, [input, config.board]);
  const boardView = useMemo(
    () =>
      config.board && (replay || initial) ? (
        <BoardPlayer
          key={job?.id ?? "initial"}
          replay={(replay || initial)!}
          config={config.board}
          autoPlay={!!replay}
        />
      ) : null,
    [config.board, replay, initial, job?.id],
  );
  return (
    <section className="game-preview stack">
      <div>
        <h3 className="panel-title">{t("Game test run")}</h3>
        <p className="panel-subtitle">
          {t(
            "Run your code on a public sample or your own board. Test runs never count toward standings or learning completion.",
          )}
        </p>
      </div>
      <div className="button-row">
        <button
          className="button button-primary"
          type="button"
          disabled={!ready || creating || (!!job && !finished && !error)}
          onClick={async () => {
            setCreating(true);
            setError("");
            try {
              const response = await fetch(
                `/api/problems/${encodeURIComponent(problemId)}/game-preview`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    input,
                    sourceCode,
                    language,
                    contestId,
                  }),
                },
              );
              const body = await response.json();
              if (!response.ok)
                throw new Error(body.error ?? "Unable to start game preview");
              setJob(body.job);
              setLastCode(language + ":" + sourceCode);
              setLastInput(input);
            } catch (error) {
              setError(
                error instanceof Error
                  ? error.message
                  : "Unable to start game preview",
              );
            } finally {
              setCreating(false);
            }
          }}
        >
          {t(
            creating || (!!job && !finished && !error)
              ? "Running game..."
              : "Run public game",
          )}
        </button>
        {job && !finished ? (
          <span className="badge badge-blue" role="status">
            {t("WJ")}
          </span>
        ) : null}
      </div>
      {boardView}
      <details>
        <summary>{t("Board input")}</summary>
        <label className="field">
          {t("Public sample or own board")}
          <textarea
            className="textarea code-block"
            maxLength={8192}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </label>
      </details>
      {lastCode &&
      (lastCode !== language + ":" + sourceCode || lastInput !== input) ? (
        <p className="text-soft">
          {t(
            "The code or board changed after this test run. Run again to refresh the replay.",
          )}
        </p>
      ) : null}
      {config.game?.protocol === "turns" && language === "brainfuck" ? (
        <p className="text-soft">
          {t(
            "Brainfuck supports the protocol but has no generic turn-based starter. Implement the input loop yourself.",
          )}
        </p>
      ) : null}
      {error || job?.error ? (
        <p role="alert">{t(error || job?.error || "")}</p>
      ) : null}
      {job?.result?.testResults[0]?.scorerDiagnostic ||
      job?.result?.testResults[0]?.message ? (
        <details>
          <summary>{t("Program diagnostics")}</summary>
          <pre className="code-block">
            {job.result.testResults[0].scorerDiagnostic ||
              job.result.testResults[0].message}
          </pre>
        </details>
      ) : null}
    </section>
  );
}
