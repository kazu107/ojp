"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { ContestJoinButton } from "@/components/contest-join-button";
import { contestStatusLabel } from "@/lib/presentation";
import { virtualIsRunning } from "@/lib/contest";
import type { ContestLiveData, ScoreboardRow } from "@/lib/types";

const ratingMessages = {
  unrated: "This contest is Unrated.",
  running: "Ratings will be calculated after the contest ends.",
  waiting_judge:
    "Ratings are pending until all judgments, including earlier Rated contests, are complete and internal errors are resolved.",
  insufficient_participants:
    "At least two eligible participants are needed to update ratings.",
  calculated:
    "OJP Elo ratings calculated. Virtual participation does not affect ratings.",
};

function countdown(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function ContestLivePanel({
  initial,
  signedIn,
}: {
  initial: ContestLiveData;
  signedIn: boolean;
}) {
  const { t } = useI18n();
  const [data, setData] = useState(initial);
  const [now, setNow] = useState(Date.parse(initial.serverNow));
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [acting, setActing] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const base = useRef({ server: Date.parse(initial.serverNow), received: 0 });
  const refreshing = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const failures = useRef(0);
  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    const abort = new AbortController();
    controller.current = abort;
    try {
      const response = await fetch(
        `/api/contests/${initial.contestId}/scoreboard`,
        {
          cache: "no-store",
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
        },
      );
      if (!response.ok) {
        if ([403, 404].includes(response.status)) setUnavailable(true);
        throw new Error(
          "Standings could not be refreshed. Retrying automatically.",
        );
      }
      const value = (await response.json()) as ContestLiveData;
      if (abort.signal.aborted) return;
      base.current = {
        server: Date.parse(value.serverNow),
        received: performance.now(),
      };
      setNow(base.current.server);
      setData(value);
      setError("");
      setUnavailable(false);
      failures.current = 0;
    } catch (error) {
      if (!abort.signal.aborted) {
        failures.current++;
        setError(
          error instanceof Error
            ? error.message
            : "Standings could not be refreshed. Retrying automatically.",
        );
      }
    } finally {
      refreshing.current = false;
      if (controller.current === abort) controller.current = null;
    }
  }, [initial.contestId]);
  useEffect(() => {
    base.current = {
      server: Date.parse(initial.serverNow),
      received: performance.now(),
    };
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(
        async () => {
          if (!document.hidden) await refresh();
          if (!disposed) schedule();
        },
        Math.min(30000, 5000 * 2 ** Math.min(failures.current, 3)),
      );
    };
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    const tick = setInterval(() => {
      if (!document.hidden)
        setNow(base.current.server + performance.now() - base.current.received);
    }, 1000);
    schedule();
    document.addEventListener("visibilitychange", visible);
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearInterval(tick);
      controller.current?.abort();
      document.removeEventListener("visibilitychange", visible);
    };
  }, [initial.serverNow, refresh]);
  async function virtual(action: "start" | "finish") {
    setActing(true);
    setError("");
    try {
      const response = await fetch(`/api/contests/${data.contestId}/virtual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "failed to update virtual participation");
      setConfirmFinish(false);
      await refresh();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "failed to update virtual participation",
      );
    } finally {
      setActing(false);
    }
  }
  const session = data.virtual?.session;
  const virtualRunning = !!session && virtualIsRunning(session, now);
  // Derive the clock locally; authorization and submit cutoffs always use server time.
  const status =
    now < Date.parse(data.startAt)
      ? "scheduled"
      : now < Date.parse(data.endAt)
        ? "running"
        : "ended";
  function table(
    rows: Array<ScoreboardRow & { displayName?: string }>,
    full: boolean,
    rated = false,
  ) {
    return (
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t("Rank")}</th>
              <th>{t("User")}</th>
              <th>{t("Total")}</th>
              <th>{t("Penalty")}</th>
              {full
                ? data.problems.map((p) => <th key={p.problemId}>{p.label}</th>)
                : null}
              {rated ? <th>{t("Rating Change")}</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.userId}>
                <td>{row.rank}</td>
                <td>{row.displayName ?? row.userId}</td>
                <td>{row.totalScore}</td>
                <td>{row.penalty}</td>
                {full
                  ? row.cells.map((cell) => (
                      <td key={cell.label}>
                        <strong>{cell.score}</strong>
                        <div className="text-soft">
                          {t("Fail:")}
                          {cell.wrongSubmissions}
                        </div>
                      </td>
                    ))
                  : null}
                {rated ? (
                  <td>
                    {(() => {
                      const change = data.ratingResult.changes.find(
                        (c) => c.userId === row.userId,
                      );
                      return change
                        ? `${change.previousRating} → ${change.rating} (${change.delta >= 0 ? "+" : ""}${change.delta})`
                        : "-";
                    })()}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (unavailable)
    return (
      <section className="panel">
        <p role="alert">{t("contest not found")}</p>
      </section>
    );
  return (
    <div className="stack">
      <section className="panel stack">
        <div className="button-row">
          <span className="badge badge-blue">
            {t(contestStatusLabel(status))}
          </span>
          <span className="badge">
            {t(data.rated ? "Rated (OJP Elo)" : "Unrated")}
          </span>
        </div>
        <p className="metric-value" aria-live="off">
          {status === "ended"
            ? t("Contest ended")
            : t(
                status === "scheduled"
                  ? "Starts in {time}"
                  : "Time remaining: {time}",
                {
                  time: countdown(
                    Date.parse(
                      status === "scheduled" ? data.startAt : data.endAt,
                    ) - now,
                  ),
                },
              )}
        </p>
        {data.canJoin && status !== "ended" ? (
          <ContestJoinButton contestId={data.contestId} joined={data.joined} />
        ) : null}
        {!signedIn ? (
          <Link
            className="button"
            href={`/signin?callbackUrl=${encodeURIComponent(`/contests/${data.contestId}`)}`}
          >
            {t("Sign in to join")}
          </Link>
        ) : null}
        <p className="text-soft">
          {t(
            "Standings refresh automatically every 5 seconds while this tab is visible.",
          )}
        </p>
        {error ? (
          <p role="alert" className="badge badge-red">
            {t(error)}
          </p>
        ) : null}
      </section>
      <section className="panel stack">
        <h2 className="panel-title">{t("Problems")}</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t("Label")}</th>
                <th>{t("Title")}</th>
                <th>{t("Maximum Points")}</th>
                <th>{t("Action")}</th>
              </tr>
            </thead>
            <tbody>
              {data.problems.map((p) => (
                <tr key={p.problemId}>
                  <td>{p.label}</td>
                  <td>{p.title ?? t("Available after the contest starts")}</td>
                  <td>{p.score}</td>
                  <td>
                    {p.canOpen ? (
                      <div className="button-row">
                        <Link
                          className="link"
                          href={`/problems/${p.problemId}?contestId=${data.contestId}${virtualRunning ? `&virtualParticipationId=${session!.id}` : ""}`}
                        >
                          {t("View")}
                        </Link>
                        <Link
                          className="link"
                          href={`/problems/${p.problemId}/submit?contestId=${data.contestId}${virtualRunning ? `&virtualParticipationId=${session!.id}` : ""}`}
                        >
                          {t(
                            virtualRunning
                              ? "Virtual Submit"
                              : status === "ended"
                                ? "Practice Submit"
                                : "Submit",
                          )}
                        </Link>
                      </div>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel stack">
        <h2 className="panel-title">{t("Official Standings")}</h2>
        <p className="text-soft">
          {t(ratingMessages[data.ratingResult.status])}
        </p>
        {data.detailLevel === "hidden" ? (
          <p>{t("このコンテストの順位表は終了後に公開されます。")}</p>
        ) : data.rows.length ? (
          table(data.rows, data.detailLevel === "full", data.rated)
        ) : (
          <p>{t("順位表データがありません。")}</p>
        )}
        {data.detailLevel === "summary" ? (
          <p className="text-soft">{t("Totals only until the contest ends")}</p>
        ) : null}
        <Link className="link" href="/ratings">
          {t("Rating Rules and Leaderboard")}
        </Link>
      </section>
      {status === "ended" ? (
        <section className="panel stack">
          <h2 className="panel-title">{t("Virtual Participation")}</h2>
          <p className="text-soft">
            {t(
              "One timed attempt per contest. Your timer is stored on the server and cannot be reset. Official standings and ratings are unaffected.",
            )}
          </p>
          {session ? (
            <>
              <p className="metric-value">
                {virtualRunning
                  ? t("Virtual time remaining: {time}", {
                      time: countdown(Date.parse(session.endAt) - now),
                    })
                  : t("Virtual participation has ended.")}
              </p>
              {data.virtual ? table(data.virtual.rows, true) : null}
              {virtualRunning ? (
                confirmFinish ? (
                  <div className="stack" role="alert">
                    <p>
                      {t("End this virtual attempt? It cannot be restarted.")}
                    </p>
                    <div className="meta-inline">
                      <button
                        type="button"
                        className="button button-secondary"
                        disabled={acting}
                        onClick={() => void virtual("finish")}
                      >
                        {t("Confirm Finish")}
                      </button>
                      <button
                        type="button"
                        className="button button-secondary"
                        disabled={acting}
                        onClick={() => setConfirmFinish(false)}
                      >
                        {t("Cancel")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={acting}
                    onClick={() => setConfirmFinish(true)}
                  >
                    {t("Finish Virtual Participation")}
                  </button>
                )
              ) : null}
            </>
          ) : data.canVirtual ? (
            <button
              type="button"
              className="button"
              disabled={acting}
              onClick={() => void virtual("start")}
            >
              {t(acting ? "Starting..." : "Start Virtual Participation")}
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
