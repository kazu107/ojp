import messages from "./messages.json";

export type Locale = "ja" | "en";
export const LOCALE_COOKIE = "ojp_locale";
export function normalizeLocale(value: unknown): Locale {
  return value === "en" ? "en" : "ja";
}
export type TranslationValues = Record<string, string | number | boolean | null | undefined>;
export type Translator = (message: string, values?: TranslationValues) => string;
const catalog: Record<string, { ja: string; en: string }> = messages;

function structuredMessage(message: string): { key: string; values: TranslationValues } | null {
  const reading = /^Reading (.+) \((\d+)\/(\d+)\)$/.exec(message);
  if (reading) return {
    key: "Reading {path} ({current}/{total})",
    values: { path: reading[1], current: reading[2], total: reading[3] },
  };
  const field = /^(.+) must be (non-empty and )?at most (\d+) characters\.$/.exec(message);
  if (field) return {
    key: field[2] ? "{field} is required and must be at most {limit} characters." : "{field} must be at most {limit} characters.",
    values: { field: field[1], limit: field[3] },
  };
  const missing = /^Missing Markdown file: (.+)$/.exec(message);
  if (missing) return { key: "Missing Markdown file: {path}", values: { path: missing[1] } };
  const duplicate = /^Duplicate (code cell id|chapter\/item ID): (.+)$/.exec(message);
  if (duplicate) return {
    key: duplicate[1] === "code cell id" ? "Duplicate code cell ID: {id}" : "Duplicate chapter/item ID: {id}",
    values: { id: duplicate[2] },
  };
  const displayName = /^displayName can be changed once every 30 days \(next: (.+)\)$/.exec(message);
  if (displayName) return {
    key: "Display Name can be changed once every 30 days (next: {date}).",
    values: { date: displayName[1] },
  };
  const slug = /^(problem|contest) slug already exists$/.exec(message);
  if (slug) return { key: "{field} slug already exists.", values: { field: slug[1] } };
  return null;
}

export function translate(locale: Locale, message: string, values?: TranslationValues): string {
  const key = message.trim();
  if (!key) return message;
  const structured = !Object.hasOwn(catalog, key) ? structuredMessage(key) : null;
  const resolvedKey = structured?.key ?? key;
  const entry = Object.hasOwn(catalog, resolvedKey) ? catalog[resolvedKey] : undefined;
  const text = entry?.[locale] ?? resolvedKey;
  const parameters = values ?? structured?.values;
  const translated = parameters ? text.replace(/\{([a-zA-Z0-9_]+)\}/g, (token, name: string) => {
    if (!Object.hasOwn(parameters, name)) return token;
    const value = String(parameters[name] ?? "");
    return structured && name === "field" ? translate(locale, value) : value;
  }) : text;
  return message.slice(0, message.length - message.trimStart().length) + translated +
    message.slice(message.trimEnd().length);
}

export function createTranslator(locale: Locale): Translator {
  return (message, values) => translate(locale, message, values);
}
