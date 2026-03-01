"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Contest, Problem, Visibility } from "@/lib/types";

interface ContestEditorFormProps {
  mode: "create" | "edit";
  availableProblems: Problem[];
  initialContest?: Contest;
}

interface FormState {
  title: string;
  slug: string;
  descriptionMarkdown: string;
  visibility: Visibility;
  startAt: string;
  endAt: string;
  penaltyMinutes: number;
  scoreboardVisibility: "hidden" | "partial" | "full";
  problemIds: string[];
}

function toDatetimeLocal(value: string): string {
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  const adjusted = new Date(date.getTime() - offset * 60000);
  return adjusted.toISOString().slice(0, 16);
}

function fromDatetimeLocal(value: string): string {
  return new Date(value).toISOString();
}

function emptyFormState(problemIds: string[]): FormState {
  const now = new Date();
  const after2h = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  return {
    title: "",
    slug: "",
    descriptionMarkdown: "",
    visibility: "public",
    startAt: toDatetimeLocal(now.toISOString()),
    endAt: toDatetimeLocal(after2h.toISOString()),
    penaltyMinutes: 5,
    scoreboardVisibility: "full",
    problemIds,
  };
}

function stateFromContest(contest: Contest): FormState {
  return {
    title: contest.title,
    slug: contest.slug,
    descriptionMarkdown: contest.descriptionMarkdown,
    visibility: contest.visibility,
    startAt: toDatetimeLocal(contest.startAt),
    endAt: toDatetimeLocal(contest.endAt),
    penaltyMinutes: contest.penaltyMinutes,
    scoreboardVisibility: contest.scoreboardVisibility,
    problemIds: contest.problems
      .sort((left, right) => left.orderIndex - right.orderIndex)
      .map((problem) => problem.problemId),
  };
}

export function ContestEditorForm({
  mode,
  availableProblems,
  initialContest,
}: ContestEditorFormProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => {
    if (mode === "edit" && initialContest) {
      return stateFromContest(initialContest);
    }
    return emptyFormState(availableProblems.slice(0, 2).map((problem) => problem.id));
  });
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const endpoint =
    mode === "edit" && initialContest ? `/api/contests/${initialContest.id}` : "/api/contests";
  const method = mode === "edit" ? "PATCH" : "POST";

  const selectedProblems = useMemo(
    () => availableProblems.filter((problem) => form.problemIds.includes(problem.id)),
    [availableProblems, form.problemIds],
  );

  function toggleProblem(problemId: string) {
    setForm((prev) => {
      const exists = prev.problemIds.includes(problemId);
      return {
        ...prev,
        problemIds: exists
          ? prev.problemIds.filter((id) => id !== problemId)
          : [...prev.problemIds, problemId],
      };
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.problemIds.length === 0) {
      setError("最低1問は選択してください。");
      return;
    }

    setError("");
    setIsSaving(true);

    try {
      const payload = {
        title: form.title,
        slug: form.slug,
        descriptionMarkdown: form.descriptionMarkdown,
        visibility: form.visibility,
        startAt: fromDatetimeLocal(form.startAt),
        endAt: fromDatetimeLocal(form.endAt),
        penaltyMinutes: form.penaltyMinutes,
        scoreboardVisibility: form.scoreboardVisibility,
        problems: form.problemIds.map((problemId, index) => ({
          label: String.fromCharCode(65 + index),
          problemId,
          score: 100,
          orderIndex: index,
        })),
      };

      const response = await fetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "保存に失敗しました。");
      }

      const body = (await response.json()) as { contest: Contest };
      router.push(`/contests/${body.contest.id}`);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "予期しないエラーが発生しました。");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="form-grid">
        <label className="field">
          <span className="field-label">タイトル</span>
          <input
            className="input"
            required
            value={form.title}
            onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
            placeholder="OJP Beginner Contest 002"
          />
        </label>
        <label className="field">
          <span className="field-label">Slug</span>
          <input
            className="input"
            required
            value={form.slug}
            onChange={(event) => setForm((prev) => ({ ...prev, slug: event.target.value }))}
            placeholder="ojp-beginner-contest-002"
          />
        </label>
      </div>

      <label className="field">
        <span className="field-label">説明</span>
        <textarea
          className="textarea"
          value={form.descriptionMarkdown}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, descriptionMarkdown: event.target.value }))
          }
        />
      </label>

      <div className="form-grid">
        <label className="field">
          <span className="field-label">Visibility</span>
          <select
            className="select"
            value={form.visibility}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, visibility: event.target.value as Visibility }))
            }
          >
            <option value="public">Public</option>
            <option value="unlisted">Unlisted</option>
            <option value="private">Private</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">開始時刻</span>
          <input
            className="input"
            type="datetime-local"
            value={form.startAt}
            onChange={(event) => setForm((prev) => ({ ...prev, startAt: event.target.value }))}
          />
        </label>
        <label className="field">
          <span className="field-label">終了時刻</span>
          <input
            className="input"
            type="datetime-local"
            value={form.endAt}
            onChange={(event) => setForm((prev) => ({ ...prev, endAt: event.target.value }))}
          />
        </label>
      </div>

      <div className="form-grid">
        <label className="field">
          <span className="field-label">Penalty (minutes)</span>
          <input
            className="input"
            type="number"
            min={0}
            value={form.penaltyMinutes}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, penaltyMinutes: Number(event.target.value) }))
            }
          />
        </label>
        <label className="field">
          <span className="field-label">Scoreboard Visibility</span>
          <select
            className="select"
            value={form.scoreboardVisibility}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                scoreboardVisibility: event.target.value as "hidden" | "partial" | "full",
              }))
            }
          >
            <option value="hidden">hidden</option>
            <option value="partial">partial</option>
            <option value="full">full</option>
          </select>
        </label>
      </div>

      <fieldset className="field">
        <legend className="field-label">問題セット</legend>
        <div className="stack">
          {availableProblems.map((problem) => {
            const selected = form.problemIds.includes(problem.id);
            return (
              <label key={problem.id} className="field">
                <span className="meta-inline">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleProblem(problem.id)}
                  />
                  <span>{problem.title}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <p className="text-soft">
        選択順で問題ラベルを `A`, `B`, `C` と割り当てます。現在:{" "}
        {selectedProblems.map((problem) => problem.title).join(", ")}
      </p>

      {error ? <p className="badge badge-red">{error}</p> : null}

      <div className="button-row">
        <button className="button" type="submit" disabled={isSaving}>
          {isSaving ? "保存中..." : mode === "edit" ? "更新する" : "作成する"}
        </button>
      </div>
    </form>
  );
}
