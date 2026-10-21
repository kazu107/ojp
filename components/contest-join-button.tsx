"use client";
import { useI18n } from "@/components/i18n-provider";


import { useState } from "react";
import { useRouter } from "next/navigation";

export function ContestJoinButton({ contestId, joined = false }: { contestId: string; joined?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [error, setError] = useState("");
  const [isJoining, setIsJoining] = useState(false);

  async function onJoin() {
    setError("");
    setIsJoining(true);
    try {
      const response = await fetch(`/api/contests/${contestId}/join`, {
        method: "POST",
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "failed to join contest");
      }
      router.refresh();
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "unexpected error");
    } finally {
      setIsJoining(false);
    }
  }

  return (
    <div className="stack">
      <button className="button" type="button" onClick={onJoin} disabled={isJoining || joined}>
        {joined ? t("Joined") : isJoining ? t("Joining...") : t("Join Contest")}
      </button>
      {error ? <p className="badge badge-red">{t(error)}</p> : null}
    </div>
  );
}
