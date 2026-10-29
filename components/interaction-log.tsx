"use client";

import { useI18n } from "./i18n-provider";

export function InteractionLog({ text }: { text?: string }) {
  const { t } = useI18n();
  if (!text) return null;
  return (
    <details className="interaction-log">
      <summary>{t("Interaction Log (Private)")}</summary>
      <pre className="code-block">{text}</pre>
    </details>
  );
}
