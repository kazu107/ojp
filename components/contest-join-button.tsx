"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ContestJoinButton({ contestId }: { contestId: string }) {
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
      <button className="button" type="button" onClick={onJoin} disabled={isJoining}>
        {isJoining ? "Joining..." : "Join Contest"}
      </button>
      {error ? <p className="badge badge-red">{error}</p> : null}
    </div>
  );
}
