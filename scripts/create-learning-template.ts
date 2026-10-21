import { writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { sampleLearningDraft } from "../lib/learning";

async function main() {
  const draft = sampleLearningDraft();
  const zip = new JSZip();
  for (const chapter of draft.chapters)
    for (const item of chapter.items)
      zip.file(`lessons/${item.id}.md`, item.markdown);
  zip.file(
    "course.json",
    JSON.stringify(
      {
        formatVersion: 1,
        ...draft,
        chapters: draft.chapters.map((chapter) => ({
          ...chapter,
          items: chapter.items.map((item) => ({
            ...item,
            markdown: "",
            markdownFile: `lessons/${item.id}.md`,
          })),
        })),
      },
      null,
      2,
    ),
  );
  const output = path.resolve(process.argv[2] ?? "learning-template.zip");
  await writeFile(
    output,
    await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
    { flag: "wx" },
  );
  console.log(`Created ${output}`);
}
void main();
