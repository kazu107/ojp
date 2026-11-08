"use client";
import { useEffect, useState } from "react";
import { useI18n } from "./i18n-provider";
import { submissionStatusLabel } from "@/lib/presentation";
import type { SubmissionStatus } from "@/lib/types";
interface RunView {
  id: string;
  status: string;
  phase: string;
  score: string | null;
  direction: string;
  evaluation: string;
  aggregate: string;
  error?: string;
  groups: Array<{
    name: string;
    completed: number;
    expected: number;
    score: string | null;
    maxTimeMs: number;
    memoryKb: number;
    cases: Array<{
      name: string;
      verdict: string;
      score: string | null;
      timeMs: number;
      memoryKb: number;
      diagnostic?: string;
    }>;
  }>;
  history: Array<{
    id: string;
    status: string;
    score: string | null;
    revisionId: string;
  }>;
}
export function HeuristicResults({ submissionId }: { submissionId: string }) {
  const { t } = useI18n();
  const [phase, setPhase] = useState("provisional");
  const [run, setRun] = useState<RunView | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function refresh() {
      if (document.hidden) {
        timer = setTimeout(refresh, 5000);
        return;
      }
      try {
        const response = await fetch(
          `/api/submissions/${submissionId}/heuristic?phase=${phase}`,
          {
            cache: "no-store",
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(15000),
            ]),
          },
        );
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        if (!disposed) {
          setRun(body.run);
          setError("");
        }
      } catch (e) {
        if (!disposed)
          setError(e instanceof Error ? e.message : "Unable to load results");
      } finally {
        if (!disposed)
          timer = setTimeout(() => {
            if (!document.hidden) void refresh();
            else timer = setTimeout(refresh, 5000);
          }, 2000);
      }
    }
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [submissionId, phase]);
  return (
    <section className="panel stack">
      <h2 className="panel-title">{t("Heuristic Results")}</h2>
      <label>
        {t("Evaluation Phase")}
        <select
          className="select"
          value={phase}
          onChange={(e) => {
            setRun(null);
            setError("");
            setPhase(e.target.value);
          }}
        >
          <option value="provisional">{t("Provisional Test Results")}</option>
          <option value="system">{t("System Test Results")}</option>
        </select>
      </label>
      {error ? <p role="alert">{t(error)}</p> : null}
      {!run ? (
        !error ? (
          <p>{t("WJ")}</p>
        ) : null
      ) : (
        <>
          <p className="meta-inline">
            <strong>
              {t("Raw Score")}:{" "}
              {run.status === "queued" || run.status === "running"
                ? "WJ"
                : (run.score ?? t("No valid score"))}
            </strong>
            <span>
              {t(run.direction)} / {t(run.evaluation)} / {t(run.aggregate)}
            </span>
          </p>
          <p className="text-soft">
            {t(
              "AC means a valid solution, not necessarily an optimal solution. Relative contest points are shown on the standings.",
            )}
          </p>
          {run.error ? <p role="alert">{t(run.error)}</p> : null}
          {run.groups.map((g) => (
            <details className="result-group" key={g.name}>
              <summary className="result-group-summary">
                {g.name}　{g.completed}/{g.expected}　{t("Raw Score")}:{" "}
                {g.completed === g.expected ? (g.score ?? "-") : "WJ"}　
                {g.maxTimeMs}
                {t(" ms / ")}
                {g.memoryKb}
                {t(" KB")}
              </summary>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t("Case")}</th>
                      <th>{t("Verdict")}</th>
                      <th>{t("Raw Score")}</th>
                      <th>{t("Time")}</th>
                      <th>{t("Memory")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.cases.map((c) => (
                      <tr key={c.name}>
                        <td>{c.name}</td>
                        <td>
                          {t(
                            submissionStatusLabel(
                              c.verdict as SubmissionStatus,
                            ),
                          )}
                        </td>
                        <td>{c.score ?? "-"}</td>
                        <td>
                          {c.timeMs}
                          {t(" ms")}
                        </td>
                        <td>
                          {c.memoryKb}
                          {t(" KB")}
                          {c.diagnostic ? (
                            <details>
                              <summary>{t("Scorer Diagnostics")}</summary>
                              <pre className="code-block">{c.diagnostic}</pre>
                            </details>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
          <details>
            <summary>{t("Evaluation History")}</summary>
            {run.history.map((h) => (
              <p key={h.id}>
                {h.id.slice(0, 8)} / {h.status} / {h.score ?? "-"} /{" "}
                {h.revisionId.slice(0, 8)}
              </p>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
