"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { readLocalDraft, removeLocalDraft, writeLocalDraft, type LocalDraft } from "@/lib/local-drafts";
import { useI18n } from "./i18n-provider";

const DraftOwner = createContext<string | null>(null);
export function DraftScope({ owner, children }: { owner: string | null; children: React.ReactNode }) {
  return <DraftOwner.Provider key={owner ?? "guest"} value={owner}>{children}</DraftOwner.Provider>;
}

export function useDraftRecovery<T>({ name, base, value, restore, prepare, enabled = true }: {
  name: string; base: string; value: T; restore: (value: T) => void;
  prepare?: (value: T) => T; enabled?: boolean;
}) {
  const owner = useContext(DraftOwner);
  const key = owner ? `${owner}:${name}` : null;
  const [pending, setPending] = useState<LocalDraft<T> | null>(null);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const writer = useRef<string>("");
  const savedAt = useRef<number | null>(null);
  const pendingRef = useRef<LocalDraft<T> | null>(null);
  useEffect(() => { pendingRef.current = pending; }, [pending]);
  const loadedKey=useRef<string|null>(null);
  const currentValue=useRef(value);
  useEffect(()=>{currentValue.current=value},[value]);
  const initial = useRef(value);
  const last = useRef(value);
  const stopped = useRef(false);
  const callbacks = useRef({ restore, prepare });
  useEffect(() => { callbacks.current = { restore, prepare }; }, [restore, prepare]);
  useEffect(() => {
    let cancelled = false;
    writer.current ||= crypto.randomUUID();
    stopped.current = false;
    initial.current=currentValue.current; last.current=currentValue.current;
    if (!key || !owner) return;
    void readLocalDraft(key, owner).then((draft) => {
      if (!cancelled) {
        loadedKey.current=key;
        setPending(draft as LocalDraft<T> | null);
        savedAt.current = draft?.updatedAt ?? null;
        setReady(true);
      }
    }).catch(() => { if (!cancelled) setMessage("Local draft storage is unavailable. Please save or export manually."); });
    return () => { cancelled = true; };
  }, [key, owner]);
  useEffect(() => {
    if (!key || !owner || !ready || loadedKey.current!==key || pending || !enabled || stopped.current || value === initial.current || value === last.current) return;
    const timer = setTimeout(() => {
      const data = callbacks.current.prepare?.(value) ?? value;
      const updatedAt = Date.now();
      void writeLocalDraft({ key, owner, writer: writer.current, updatedAt, base, data }, savedAt.current).then(() => {
        savedAt.current = updatedAt; last.current = value; setMessage("Saved on this device.");
      }).catch((error) => {
        stopped.current = true; setMessage(error instanceof Error ? error.message : "Unable to save a local draft.");
        if (error instanceof Error && error.message.startsWith("Another tab")) {
          void readLocalDraft(key, owner).then(row => setPending(row as LocalDraft<T> | null)).catch(() => {});
        }
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [key, owner, ready, pending, enabled, value, base]);
  useEffect(() => () => {
    if (!key || !owner || loadedKey.current !== key || pendingRef.current || currentValue.current === initial.current || currentValue.current === last.current) return;
    try {
      const data = callbacks.current.prepare?.(currentValue.current) ?? currentValue.current;
      void writeLocalDraft({ key, owner, writer: writer.current, updatedAt: Date.now(), base, data }, savedAt.current).catch(() => {});
    } catch { /* Keep the previous draft if recovery data cannot be serialized. */ }
  }, [key, owner, base]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (key && ready && !pending && value !== initial.current && value !== last.current) {
        event.preventDefault(); event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [key, ready, pending, value]);
  async function clear(savedValue?: unknown) {
    stopped.current = true;
    if (key) await removeLocalDraft(key).catch(() => {});
    last.current = (savedValue ?? value) as T;
    stopped.current = false;
    setPending(null); setMessage("");
  }
  return { pending, message, stale: pending !== null && pending.base !== base,
    restore() { if (pending) { try { callbacks.current.restore(pending.data); savedAt.current = pending.updatedAt; stopped.current = false; setPending(null); setMessage("Local draft restored."); } catch { setMessage("Invalid local draft."); } } },
    async discard() { await clear(); savedAt.current = null; last.current = value; stopped.current = false; },
    clear,
  };
}

export function DraftRecovery({ draft }: { draft: ReturnType<typeof useDraftRecovery> }) {
  const { t } = useI18n();
  if (!draft.pending && !draft.message) return null;
  return <aside className="panel stack" aria-live="polite">
    {draft.pending ? <>
      <p>{t("An unsaved draft was found on this device. It expires after 14 days.")}</p>
      {draft.stale ? <p className="badge badge-red">{t("The server version has changed. Review the restored content before saving.")}</p> : null}
      <div className="button-row">
        <button type="button" className="button button-secondary" onClick={draft.restore}>{t("Restore Draft")}</button>
        <button type="button" className="button button-secondary" onClick={() => void draft.discard()}>{t("Discard Draft")}</button>
      </div>
    </> : <p className="text-soft">{t(draft.message)}</p>}
  </aside>;
}
