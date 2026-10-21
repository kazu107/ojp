"use client";

import ReactMarkdown, { type ExtraProps } from "react-markdown";
import { createContext, useContext, useMemo, type ComponentProps } from "react";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { Root } from "mdast";
import { runnableCell, visitMarkdownCodes } from "@/lib/learning";
import type { CellSettings } from "@/lib/learning";
import { LearningCodeCell } from "@/components/learning-code-cell";

function remarkLearningCells() {
  return (tree: Root) => {
    visitMarkdownCodes(tree, (node) => {
      const cell = runnableCell(node);
      if (cell)
        node.data = {
          ...node.data,
          hProperties: {
            "data-cell-id": cell.id,
            "data-cell-language": cell.language,
            "data-cell-source": cell.source,
          },
        };
    });
  };
}

interface CellContext {
  cells: Record<string, CellSettings>;
  storagePrefix: string;
}
const MarkdownCellContext = createContext<CellContext | null>(null);

// A stable renderer type keeps cells mounted when locale/server props refresh.
function LearningPre({ node, children, ...props }: ComponentProps<"pre"> & ExtraProps) {
  const context = useContext(MarkdownCellContext);
  const code = node?.children.find(
    (child) => child.type === "element" && child.tagName === "code",
  );
  if (context && code?.type === "element" && typeof code.properties["data-cell-id"] === "string") {
    const { cells, storagePrefix } = context;
    const id = code.properties["data-cell-id"];
    const language = code.properties["data-cell-language"];
    if (language === "python" || language === "javascript") {
      const source = String(code.properties["data-cell-source"] ?? "");
      const previewKey = storagePrefix.startsWith("ojp:learn:preview:")
        ? JSON.stringify([source, cells[id]])
        : "";
      return (
        <LearningCodeCell
          key={`${storagePrefix}:${id}:${previewKey}`}
          cell={{ id, language, source }}
          settings={cells[id]}
          storagePrefix={storagePrefix}
        />
      );
    }
  }
  return <pre {...props}>{children}</pre>;
}
const markdownComponents = { pre: LearningPre };

export function LearningMarkdown({
  text,
  cells,
  storagePrefix,
}: {
  text: string;
  cells: Record<string, CellSettings>;
  storagePrefix: string;
}) {
  const context = useMemo(() => ({ cells, storagePrefix }), [cells, storagePrefix]);
  return (
    <MarkdownCellContext.Provider value={context}>
      <div className="markdown-block learning-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkLearningCells]}
        rehypePlugins={[rehypeKatex]}
        components={markdownComponents}
      >
        {text}
      </ReactMarkdown>
      </div>
    </MarkdownCellContext.Provider>
  );
}
