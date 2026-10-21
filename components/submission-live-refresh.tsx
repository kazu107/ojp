"use client";
import { useI18n } from "@/components/i18n-provider";


import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { SubmissionStatus } from "@/lib/types";
import { isWaitingSubmissionStatus } from "@/lib/submission-status";

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
  const { t } = useI18n();
  const router = useRouter();

  useEffect(() => {
    if (!isWaitingSubmissionStatus(status)) {
      return;
    }

    const timer = setInterval(() => {
      router.refresh();
    }, intervalMs);

    return () => clearInterval(timer);
  }, [intervalMs, router, status]);

  if (!isWaitingSubmissionStatus(status)) {
    return null;
  }

  return (
    <p className="badge badge-blue">
      {t(message ?? "This submission is waiting for judge. The page refreshes automatically.")}
    </p>
  );
}
