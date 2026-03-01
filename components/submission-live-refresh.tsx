"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { SubmissionStatus } from "@/lib/types";

interface SubmissionLiveRefreshProps {
  status: SubmissionStatus;
  intervalMs?: number;
  message?: string;
}

export function SubmissionLiveRefresh({
  status,
  intervalMs = 2000,
  message,
}: SubmissionLiveRefreshProps) {
  const router = useRouter();

  useEffect(() => {
    if (status !== "WJ") {
      return;
    }

    const timer = setInterval(() => {
      router.refresh();
    }, intervalMs);

    return () => clearInterval(timer);
  }, [intervalMs, router, status]);

  if (status !== "WJ") {
    return null;
  }

  return (
    <p className="badge badge-blue">
      {message ?? "This submission is waiting for judge. The page refreshes automatically."}
    </p>
  );
}
