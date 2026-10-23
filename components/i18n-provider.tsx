"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveLocale } from "@/lib/i18n/actions";
import { createTranslator, type Locale, type Translator } from "@/lib/i18n/shared";

type I18nContextValue = {
  locale: Locale; t: Translator; pending: boolean; error: string;
  changeLocale: (locale: Locale) => void;
};
const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ initialLocale, children }: {
  initialLocale: Locale; children: React.ReactNode;
}) {
  const [locale, setLocale] = useState(initialLocale);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const channelRef = useRef<BroadcastChannel | null>(null);
  const t = useMemo(() => createTranslator(locale), [locale]);
  useEffect(() => {
    let disposed = false;
    queueMicrotask(() => { if (!disposed) setLocale(initialLocale); });
    return () => { disposed = true; };
  }, [initialLocale]);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    let channel: BroadcastChannel;
    try { channel = new BroadcastChannel("ojp:ui-locale"); }
    catch { return; }
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data !== "ja" && event.data !== "en") return;
      setLocale(event.data);
      setError("");
      router.refresh();
    };
    return () => { channelRef.current = null; channel.close(); };
  }, [router]);
  function changeLocale(next: Locale) {
    if (next === locale || pending) return;
    const previous = locale;
    setError("");
    setLocale(next);
    startTransition(async () => {
      try {
        await saveLocale(next);
        try { channelRef.current?.postMessage(next); }
        catch { /* Cross-tab notifications are optional. */ }
      }
      catch {
        setLocale(previous);
        setError("Language could not be saved. Please try again.");
      }
    });
  }
  return <I18nContext.Provider value={{ locale, t, pending, error, changeLocale }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("I18nProvider is missing.");
  return context;
}
