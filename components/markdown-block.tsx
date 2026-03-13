import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

export function MarkdownBlock({ text }: { text: string }) {
  return (
    <div className="markdown-block">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
