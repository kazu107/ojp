"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const PRESET_REASONS = [
  "judge update",
  "testcase fix",
  "scoring bug",
  "manual review",
];

export function RejudgeRequestForm({ submissionId }: { submissionId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState(PRESET_REASONS[0]);
  const [detail, setDetail] = useState("");
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSending(true);

    try {
      const response = await fetch(`/api/submissions/${submissionId}/rejudge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason,
          detail,
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "rejudge failed");
      }
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "unexpected error");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="form-grid">
        <label className="field">
          <span className="field-label">Reason preset</span>
          <select className="select" value={reason} onChange={(event) => setReason(event.target.value)}>
            {PRESET_REASONS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Additional detail</span>
          <input
            className="input"
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
            placeholder="optional note"
          />
        </label>
      </div>
      {error ? <p className="badge badge-red">{error}</p> : null}
      <div className="button-row">
        <button className="button button-secondary" type="submit" disabled={isSending}>
          {isSending ? "Requesting..." : "Request Rejudge"}
        </button>
      </div>
    </form>
  );
}
