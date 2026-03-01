"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ReportTargetType } from "@/lib/types";

interface ReportFormProps {
  targetType: ReportTargetType;
  targetId: string;
}

export function ReportForm({ targetType, targetId }: ReportFormProps) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState("");
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSending(true);

    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType,
          targetId,
          reason,
          detail,
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "report failed");
      }
      router.push("/");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "unexpected error");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <p className="text-soft">
        Target: {targetType}:{targetId}
      </p>
      <label className="field">
        <span className="field-label">Reason</span>
        <input
          className="input"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="statement ambiguous / abusive content / other"
          required
        />
      </label>
      <label className="field">
        <span className="field-label">Detail</span>
        <textarea
          className="textarea"
          value={detail}
          onChange={(event) => setDetail(event.target.value)}
          placeholder="Describe what should be checked by moderators."
        />
      </label>
      {error ? <p className="badge badge-red">{error}</p> : null}
      <div className="button-row">
        <button className="button" type="submit" disabled={isSending}>
          {isSending ? "Sending..." : "Submit Report"}
        </button>
      </div>
    </form>
  );
}
