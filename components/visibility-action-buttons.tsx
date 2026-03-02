"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Visibility } from "@/lib/types";

interface VisibilityActionButtonsProps {
  resourceType: "problem" | "contest";
  resourceId: string;
  visibility: Visibility;
}

function endpointBase(resourceType: "problem" | "contest", resourceId: string): string {
  if (resourceType === "problem") {
    return `/api/problems/${resourceId}`;
  }
  return `/api/contests/${resourceId}`;
}

export function VisibilityActionButtons({
  resourceType,
  resourceId,
  visibility,
}: VisibilityActionButtonsProps) {
  const router = useRouter();
  const [busyAction, setBusyAction] = useState<"" | "publish" | "unpublish">("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const base = endpointBase(resourceType, resourceId);

  async function callAction(action: "publish" | "unpublish") {
    setError("");
    setMessage("");
    setBusyAction(action);

    try {
      const response = await fetch(`${base}/${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reason: `${resourceType} ${action} requested`,
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string; message?: string };
        throw new Error(body.error ?? body.message ?? `${action} failed`);
      }
      setMessage(action === "publish" ? "Published." : "Unpublished.");
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "unexpected error");
    } finally {
      setBusyAction("");
    }
  }

  return (
    <div className="stack">
      <p className="text-soft">Current visibility: {visibility}</p>
      <div className="button-row">
        <button
          className="button"
          type="button"
          disabled={busyAction !== "" || visibility === "public"}
          onClick={() => callAction("publish")}
        >
          Publish
        </button>
        <button
          className="button button-secondary"
          type="button"
          disabled={busyAction !== "" || visibility === "private"}
          onClick={() => callAction("unpublish")}
        >
          Unpublish
        </button>
      </div>
      {error ? <p className="badge badge-red">{error}</p> : null}
      {message ? <p className="badge badge-green">{message}</p> : null}
    </div>
  );
}
