"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/i18n-provider";
import type { Contest, ContestProblem, Problem, Visibility } from "@/lib/types";

function localDate(value: string) {
  return new Date(Date.parse(value) + 9 * 3600_000).toISOString().slice(0, 16);
}

function nextLabel(items: ContestProblem[]) {
  for (let i = 0; i < 100; i++) {
    const label = i < 26 ? String.fromCharCode(65 + i) : `P${i + 1}`;
    if (!items.some((p) => p.label === label)) return label;
  }
  return "";
}

export function ContestEditorForm({
  mode,
  availableProblems,
  initialContest,
  structureLocked = false,
  initialDates,
}: {
  mode: "create" | "edit";
  availableProblems: Problem[];
  initialContest?: Contest;
  structureLocked?: boolean;
  initialDates?: { startAt: string; endAt: string };
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [form, setForm] = useState(() => ({
    title: initialContest?.title ?? "",
    slug: initialContest?.slug ?? "",
    descriptionMarkdown: initialContest?.descriptionMarkdown ?? "",
    visibility: initialContest?.visibility ?? ("public" as Visibility),
    startAt: localDate(
      initialContest?.startAt ??
        initialDates?.startAt ??
        new Date(Date.now() + 3600_000).toISOString(),
    ),
    endAt: localDate(
      initialContest?.endAt ??
        initialDates?.endAt ??
        new Date(Date.now() + 3 * 3600_000).toISOString(),
    ),
    penaltyMinutes: initialContest?.penaltyMinutes ?? 5,
    scoreboardVisibility: initialContest?.scoreboardVisibility ?? "full",
    rated: initialContest?.rated ?? false,
    problems: [...(initialContest?.problems ?? [])].sort(
      (a, b) => a.orderIndex - b.orderIndex,
    ),
  }));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  function problemChange(index: number, change: Partial<ContestProblem>) {
    setForm((current) => ({
      ...current,
      problems: current.problems.map((p, i) =>
        i === index ? { ...p, ...change } : p,
      ),
    }));
  }
  function toggle(id: string) {
    setForm((current) => ({
      ...current,
      problems: (current.problems.some((p) => p.problemId === id)
        ? current.problems.filter((p) => p.problemId !== id)
        : [
            ...current.problems,
            {
              problemId: id,
              label: nextLabel(current.problems),
              score: 100,
              orderIndex: current.problems.length,
            },
          ]
      ).map((p, i) => ({ ...p, orderIndex: i })),
    }));
  }
  function move(index: number, offset: number) {
    setForm((current) => {
      const next = [...current.problems];
      [next[index], next[index + offset]] = [next[index + offset], next[index]];
      return {
        ...current,
        problems: next.map((p, i) => ({ ...p, orderIndex: i })),
      };
    });
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (!form.problems.length)
        throw new Error("Select between 1 and 100 contest problems.");
      const response = await fetch(
        mode === "edit"
          ? `/api/contests/${initialContest!.id}`
          : "/api/contests",
        {
          method: mode === "edit" ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...form,
            startAt: structureLocked
              ? initialContest!.startAt
              : new Date(`${form.startAt}:00+09:00`).toISOString(),
            endAt: structureLocked
              ? initialContest!.endAt
              : new Date(`${form.endAt}:00+09:00`).toISOString(),
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "保存に失敗しました。");
      router.push(`/contests/${body.contest.id}`);
      router.refresh();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "予期しないエラーが発生しました。",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="form" onSubmit={save}>
      <div className="form-grid">
        <label className="field">
          <span className="field-label">{t("タイトル")}</span>
          <input
            className="input"
            required
            maxLength={200}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="field-label">{t("Slug")}</span>
          <input
            className="input"
            required
            maxLength={100}
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
          />
        </label>
      </div>
      <label className="field">
        <span className="field-label">{t("説明")}</span>
        <textarea
          className="textarea"
          value={form.descriptionMarkdown}
          onChange={(e) =>
            setForm({ ...form, descriptionMarkdown: e.target.value })
          }
        />
      </label>
      {structureLocked ? (
        <p className="text-soft">
          {t(
            "Timing, problem set, points, penalty and Rated settings are locked after the contest starts.",
          )}
        </p>
      ) : null}
      <p className="text-soft">
        {t("Times use Japan Standard Time (UTC+09:00).")}
      </p>
      <div className="form-grid">
        <label className="field">
          <span className="field-label">{t("開始日時")}</span>
          <input
            className="input"
            type="datetime-local"
            required
            disabled={structureLocked}
            value={form.startAt}
            onChange={(e) => setForm({ ...form, startAt: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="field-label">{t("終了日時")}</span>
          <input
            className="input"
            type="datetime-local"
            required
            disabled={structureLocked}
            value={form.endAt}
            onChange={(e) => setForm({ ...form, endAt: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="field-label">{t("Penalty (minutes)")}</span>
          <input
            className="input"
            type="number"
            min={0}
            max={1440}
            step={1}
            disabled={structureLocked}
            value={form.penaltyMinutes}
            onChange={(e) =>
              setForm({ ...form, penaltyMinutes: Number(e.target.value) })
            }
          />
        </label>
        <label className="field">
          <span className="field-label">{t("Visibility")}</span>
          <select
            className="select"
            value={form.visibility}
            onChange={(e) =>
              setForm({ ...form, visibility: e.target.value as Visibility })
            }
          >
            <option value="public">{t("Public")}</option>
            <option value="unlisted">{t("Unlisted")}</option>
            <option value="private">{t("Private")}</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t("Scoreboard")}</span>
          <select
            className="select"
            value={form.scoreboardVisibility}
            onChange={(e) =>
              setForm({
                ...form,
                scoreboardVisibility: e.target.value as
                  | "hidden"
                  | "partial"
                  | "full",
              })
            }
          >
            <option value="full">{t("Full standings")}</option>
            <option value="partial">
              {t("Totals only until the contest ends")}
            </option>
            <option value="hidden">{t("Hidden until the contest ends")}</option>
          </select>
        </label>
      </div>
      <label className="meta-inline">
        <input
          type="checkbox"
          checked={form.rated}
          disabled={structureLocked}
          onChange={(e) => setForm({ ...form, rated: e.target.checked })}
        />
        {t("Rated contest (OJP Elo)")}
      </label>
      <p className="text-soft">
        {t(
          "Rated requires a public contest and at least two eligible participants. Organizers, problem authors and virtual participants are excluded.",
        )}
      </p>
      <fieldset className="field" disabled={structureLocked}>
        <legend className="field-label">{t("問題セット")}</legend>
        <div className="stack">
          {availableProblems.map((problem) => (
            <label key={problem.id} className="meta-inline">
              <input
                type="checkbox"
                aria-label={t("Select problem {title} ({id})", {
                  title: problem.title,
                  id: problem.id,
                })}
                checked={form.problems.some((p) => p.problemId === problem.id)}
                onChange={() => toggle(problem.id)}
              />
              {problem.title}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t("Label")}</th>
              <th>{t("Title")}</th>
              <th>{t("Maximum Points")}</th>
              <th>{t("Order")}</th>
            </tr>
          </thead>
          <tbody>
            {form.problems.map((p, index) => (
              <tr key={p.problemId}>
                <td>
                  <input
                    className="input"
                    aria-label={t("Problem label {index}", {
                      index: index + 1,
                    })}
                    maxLength={16}
                    required
                    disabled={structureLocked}
                    value={p.label}
                    onChange={(e) =>
                      problemChange(index, { label: e.target.value })
                    }
                  />
                </td>
                <td>
                  {availableProblems.find((item) => item.id === p.problemId)
                    ?.title ?? p.problemId}
                </td>
                <td>
                  <input
                    className="input"
                    aria-label={t("Maximum points {index}", {
                      index: index + 1,
                    })}
                    type="number"
                    min={1}
                    max={1000000}
                    step={1}
                    required
                    disabled={structureLocked}
                    value={p.score}
                    onChange={(e) =>
                      problemChange(index, { score: Number(e.target.value) })
                    }
                  />
                </td>
                <td>
                  <div className="button-row">
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={structureLocked || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      {t("Move Up")}
                    </button>
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={
                        structureLocked || index === form.problems.length - 1
                      }
                      onClick={() => move(index, 1)}
                    >
                      {t("Move Down")}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-soft">
        {t(
          "Problem scores (0-100) are scaled to the configured maximum points. Partial scores are retained to two decimal places.",
        )}
      </p>
      {error ? (
        <p className="badge badge-red" role="alert">
          {t(error)}
        </p>
      ) : null}
      <button className="button" type="submit" disabled={saving}>
        {saving
          ? t("保存中...")
          : mode === "edit"
            ? t("更新する")
            : t("作成する")}
      </button>
    </form>
  );
}
