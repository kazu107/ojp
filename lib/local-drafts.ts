export const DRAFT_TTL_MS = 14 * 86400_000;
export const MAX_DRAFT_BYTES = 2 * 1024 * 1024;
export interface LocalDraft<T = unknown> {
  key: string;
  owner: string;
  writer: string;
  updatedAt: number;
  base: string;
  data: T;
}

export function validDraft(value: unknown, owner: string, now = Date.now()): value is LocalDraft {
  if (!value || typeof value !== "object") return false;
  const row = value as LocalDraft;
  return row.owner === owner && typeof row.key === "string" && typeof row.writer === "string" &&
    typeof row.base === "string" && typeof row.updatedAt === "number" && row.updatedAt <= now + 60000 &&
    now - row.updatedAt < DRAFT_TTL_MS && row.data !== undefined;
}

function openDrafts(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("ojp-local-drafts", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts", { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readLocalDraft(key: string, owner: string): Promise<LocalDraft | null> {
  const db = await openDrafts();
  try {
    const row = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction("drafts").objectStore("drafts").get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return validDraft(row, owner) ? row : null;
  } finally { db.close(); }
}

export function draftFits(data: unknown): boolean {
  return new TextEncoder().encode(JSON.stringify(data)).byteLength <= MAX_DRAFT_BYTES;
}

const operations = new Map<string, Promise<void>>();
function ordered(key: string, operation: () => Promise<void>): Promise<void> {
  const next = (operations.get(key) ?? Promise.resolve()).catch(() => {}).then(operation);
  operations.set(key, next);
  const cleanup = () => { if (operations.get(key) === next) operations.delete(key); };
  void next.then(cleanup, cleanup);
  return next;
}
export function writeLocalDraft(row: LocalDraft, expectedAt: number | null): Promise<void> {
  return ordered(row.key, () => writeDraft(row, expectedAt));
}
async function writeDraft(row: LocalDraft, expectedAt: number | null): Promise<void> {
  if (!draftFits(row.data)) throw new Error("Local draft is too large. Export a ZIP instead.");
  const db = await openDrafts();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite");
      const store = tx.objectStore("drafts");
      const request = store.get(row.key);
      let conflict = false;
      request.onsuccess = () => {
        const previous = request.result as LocalDraft | undefined;
        if (previous && previous.owner === row.owner && previous.writer !== row.writer && previous.updatedAt !== expectedAt && validDraft(previous, row.owner)) {
          conflict = true; tx.abort(); return;
        }
        store.put(row);
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const entry = cursor.result;
          if (!entry) return;
          const value = entry.value as LocalDraft;
          if (value.owner === row.owner && !validDraft(value, row.owner)) entry.delete();
          entry.continue();
        };
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(new Error(conflict ? "Another tab changed this draft. Restore or discard it first." : "Unable to save a local draft."));
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export function removeLocalDraft(key: string): Promise<void> { return ordered(key, () => removeDraft(key)); }
async function removeDraft(key: string): Promise<void> {
  const db = await openDrafts();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite");
      tx.objectStore("drafts").delete(key);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
