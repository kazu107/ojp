"use client";
import { useI18n } from "@/components/i18n-provider";
import { UiText } from "@/components/ui-text";


import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  learningRunnerDocument,
  validLearningRunMessage,
} from "@/lib/learning-runner";
import {
  LEARNING_EXECUTION_MS,
  LEARNING_MAX_OUTPUT,
  LEARNING_PREPARATION_MS,
} from "@/lib/learning";
import type { CellSettings, RunnableCell } from "@/lib/learning";

const CodeEditor = dynamic(
  () => import("@/components/code-editor").then((module) => module.CodeEditor),
  {
    ssr: false,
    loading: () => <p className="text-soft"><UiText text="エディターを準備しています…" /></p>,
  },
);

interface Props {
  cell: RunnableCell;
  settings?: CellSettings;
  storagePrefix: string;
}

export function LearningCodeCell({ cell, settings, storagePrefix }: Props) {
  const { t } = useI18n();
  const key = `${storagePrefix}:cell:${cell.id}`;
  const [source, setSource] = useState(cell.source);
  const [stdin, setStdin] = useState(settings?.stdin ?? "");
  const [stdout, setStdout] = useState("");
  const [stderr, setStderr] = useState("");
  const [runError, setRunError] = useState("");
  const [phase, setPhase] = useState<"idle" | "preparing" | "running">("idle");
  const container = useRef<HTMLDivElement>(null);
  const dispose = useRef<(() => void) | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (storagePrefix.startsWith("ojp:learn:preview:")) {
      return () => {
        dispose.current?.();
      };
    }
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null");
      if (
        saved &&
        typeof saved.source === "string" &&
        saved.source.length <= 262144 &&
        typeof saved.stdin === "string" &&
        saved.stdin.length <= 65536
      ) {
        if (!settings?.readOnly) setSource(saved.source);
        setStdin(saved.stdin);
      }
    } catch {
      /* Browser storage can be unavailable or full. */
    }
    initialized.current = true;
    return () => {
      dispose.current?.();
    };
  }, [key, settings?.readOnly, storagePrefix]);

  function save(nextSource: string, nextStdin: string) {
    if (!initialized.current) return;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ source: nextSource, stdin: nextStdin }),
      );
    } catch {
      /* Running code does not depend on browser storage. */
    }
  }
  function stop() {
    dispose.current?.();
    dispose.current = null;
    setPhase("idle");
  }
  function run() {
    stop();
    setStdout("");
    setStderr("");
    setRunError("");
    setPhase("preparing");
    const token = crypto.randomUUID();
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("aria-hidden", "true");
    frame.referrerPolicy = "no-referrer";
    frame.style.display = "none";
    frame.srcdoc = learningRunnerDocument(
      window.location.origin,
      crypto.randomUUID(),
      token,
    );
    let size = 0;
    let messages = 0;
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let finished = false;
    let started = false;
    let outputTimer: ReturnType<typeof setTimeout> | null = null;
    function flush() {
      if (stdoutBuffer) {
        const text = stdoutBuffer;
        stdoutBuffer = "";
        setStdout((current) => current + text);
      }
      if (stderrBuffer) {
        const text = stderrBuffer;
        stderrBuffer = "";
        setStderr((current) => current + text);
      }
      outputTimer = null;
    }
    let watchdog = setTimeout(
      () => finish("実行環境の準備がタイムアウトしました。"),
      LEARNING_PREPARATION_MS + 2000,
    );
    function cleanup() {
      finished = true;
      clearTimeout(watchdog);
      if (outputTimer) clearTimeout(outputTimer);
      window.removeEventListener("message", receive);
      frame.remove();
    }
    function finish(error: string | null) {
      if (finished) return;
      flush();
      cleanup();
      dispose.current = null;
      if (error) setRunError(error);
      setPhase("idle");
    }
    function receive(event: MessageEvent) {
      if (
        event.source !== frame.contentWindow ||
        event.data?.token !== token ||
        !validLearningRunMessage(event.data) ||
        finished
      )
        return;
      const message = event.data;
      if (++messages > 10000)
        return finish("出力メッセージが多すぎるため停止しました。");
      if (message.type === "ready") {
        frame.contentWindow!.postMessage(
          { token, type: "run", language: cell.language, source, stdin },
          "*",
        );
      } else if (message.type === "running") {
        if (started) return;
        started = true;
        clearTimeout(watchdog);
        watchdog = setTimeout(
          () => finish("実行時間の上限（10秒）を超えました。"),
          LEARNING_EXECUTION_MS + 500,
        );
        setPhase("running");
      } else if (message.type === "output") {
        size += new TextEncoder().encode(message.text).length;
        if (size > LEARNING_MAX_OUTPUT)
          return finish("出力の上限（64 KiB）を超えました。");
        if (message.stream === "stdout") stdoutBuffer += message.text;
        else stderrBuffer += message.text;
        if (!outputTimer) outputTimer = setTimeout(flush, 60);
      } else if (message.type === "done") finish(message.error);
    }
    dispose.current = cleanup;
    window.addEventListener("message", receive);
    container.current!.appendChild(frame);
  }

  return (
    <section
      className="learning-code-cell"
      aria-label={t("実行コード {value0}", { value0: cell.id })}
    >
      <div className="learning-cell-head">
        <span className="badge badge-blue">{t(cell.language)}</span>
        <span className="text-soft">{cell.id}</span>
        <span className="text-soft">{t("ブラウザで試し実行")}</span>
      </div>
      {settings?.readOnly ? (
        <pre className="mono">{source}</pre>
      ) : (
        <CodeEditor
          language={cell.language}
          minHeight={190}
          value={source}
          onChange={(value) => {
            setSource(value);
            save(value, stdin);
          }}
        />
      )}
      <label className="field">
        <span className="field-label">{t("標準入力")}</span>
        <textarea
          className="textarea mono"
          rows={3}
          value={stdin}
          maxLength={65536}
          onChange={(event) => {
            setStdin(event.target.value);
            save(source, event.target.value);
          }}
        />
      </label>
      <div className="button-row">
        <button
          type="button"
          className="button"
          disabled={phase !== "idle"}
          onClick={run}
        >
          {phase === "preparing" ? t("実行環境を準備中…") : phase === "running" ? t("実行中…") : t("実行")}
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={phase === "idle"}
          onClick={stop}
        >
          {t("停止")}</button>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => {
            stop();
            setSource(cell.source);
            setStdin(settings?.stdin ?? "");
            setStdout("");
            setStderr("");
            setRunError("");
            save(cell.source, settings?.stdin ?? "");
          }}
        >
          {t("初期コードに戻す")}</button>
      </div>
      <div aria-live="polite">
        <p className="field-label">{t("標準出力")}</p>
        <pre className="learning-output">{stdout || t("（出力なし）")}</pre>
        {stderr || runError ? (
          <>
            <p className="field-label">{t("エラー")}</p>
            <pre className="learning-output learning-output-error">
              {stderr}{stderr && runError ? "\n" : ""}{runError ? t(runError) : ""}
            </pre>
          </>
        ) : null}
      </div>
      <div ref={container} />
    </section>
  );
}
