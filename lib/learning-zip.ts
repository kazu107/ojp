import JSZip from "jszip";
import {
  LearningError,
  LEARNING_MAX_BODY_BYTES,
  validateLearningDraft,
} from "./learning";

// JSZip exposes this streaming API but omits it from JSZipObject's typings.
type StreamingZipObject = JSZip.JSZipObject & {
  internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
};

async function boundedZipText(
  file: JSZip.JSZipObject,
  budget: { used: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    const stream = (file as StreamingZipObject).internalStream("uint8array");
    let size = 0;
    let stopped = false;
    stream.on("data", (chunk: Uint8Array) => {
      if (stopped) return;
      budget.used += chunk.byteLength;
      if (budget.used > LEARNING_MAX_BODY_BYTES) {
        stopped = true;
        stream.pause();
        chunks.length = 0;
        reject(new LearningError("Expanded ZIP exceeds 2 MiB."));
        return;
      }
      size += chunk.byteLength;
      chunks.push(chunk);
    });
    stream.on("error", (error: Error) => {
      if (!stopped) {
        stopped = true;
        reject(error);
      }
    });
    stream.on("end", () => {
      if (stopped) return;
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      try {
        resolve(
          new TextDecoder("utf-8", { fatal: true })
            .decode(bytes)
            .replace(/^\uFEFF/, ""),
        );
      } catch {
        reject(new LearningError("ZIP text files must use UTF-8."));
      }
    });
    stream.resume();
  });
}

export async function importLearningZip(data: Uint8Array) {
  if (data.length > LEARNING_MAX_BODY_BYTES)
    throw new LearningError("Learning ZIP must be at most 2 MiB.");
  const zip = await JSZip.loadAsync(data);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > 250) throw new LearningError("Too many ZIP entries.");
  // Reject declared oversized entries early; boundedZipText also enforces actual inflated bytes.
  let expanded = 0;
  for (const entry of entries) {
    const original =
      (
        entry as unknown as {
          unsafeOriginalName?: string;
          _data?: { uncompressedSize?: number };
        }
      ).unsafeOriginalName ?? entry.name;
    if (
      original !== entry.name ||
      original.includes("\\") ||
      original.startsWith("/") ||
      original.split("/").includes("..")
    )
      throw new LearningError("Unsafe ZIP path.");
    // JSZip represents empty entries as a resolved promise rather than a CompressedObject.
    const size =
      (entry as unknown as { _data?: { uncompressedSize?: number } })._data
        ?.uncompressedSize ?? 0;
    if (!Number.isSafeInteger(size) || size < 0)
      throw new LearningError("Invalid ZIP entry size.");
    expanded += size;
    if (expanded > LEARNING_MAX_BODY_BYTES || size > LEARNING_MAX_BODY_BYTES)
      throw new LearningError("Expanded ZIP exceeds 2 MiB.");
  }
  const config = zip.file("course.json");
  if (!config) throw new LearningError("ZIP must contain course.json.");
  const budget = { used: 0 };
  const raw = JSON.parse(await boundedZipText(config, budget));
  if (
    !raw ||
    raw.formatVersion !== 1 ||
    !Array.isArray(raw.chapters) ||
    raw.chapters.length > 50
  )
    throw new LearningError("Unsupported learning ZIP format.");
  let itemCount = 0;
  for (const chapter of raw.chapters) {
    if (!chapter || !Array.isArray(chapter.items) || chapter.items.length > 50)
      throw new LearningError("Invalid chapter.");
    for (const item of chapter.items) {
      if (!item || ++itemCount > 200)
        throw new LearningError("Too many or invalid learning items.");
      if (
        typeof item.markdownFile !== "string" ||
        !/^lessons\/[a-zA-Z0-9_-]+\.md$/.test(item.markdownFile)
      )
        throw new LearningError("Invalid Markdown path.");
      const file = zip.file(item.markdownFile);
      if (!file)
        throw new LearningError(`Missing Markdown file: ${item.markdownFile}`);
      item.markdown = await boundedZipText(file, budget);
    }
  }
  return validateLearningDraft(raw);
}
