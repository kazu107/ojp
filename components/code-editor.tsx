"use client";

import CodeMirror from "@uiw/react-codemirror";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { EditorView } from "@codemirror/view";
import { Language } from "@/lib/types";

type CodeEditorLanguage = Language | "markdown";

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language: CodeEditorLanguage;
  minHeight?: number;
}

const editorTheme = EditorView.theme(
  {
    "&": {
      border: "1px solid rgba(255, 255, 255, 0.16)",
      borderRadius: "10px",
      overflow: "hidden",
      backgroundColor: "rgba(3, 8, 15, 0.72)",
      fontSize: "0.92rem",
    },
    ".cm-scroller": {
      fontFamily: "var(--font-jp-mono), monospace",
    },
    ".cm-gutters": {
      backgroundColor: "rgba(255, 255, 255, 0.04)",
      borderRight: "1px solid rgba(255, 255, 255, 0.08)",
      color: "var(--text-soft)",
    },
    ".cm-activeLine": {
      backgroundColor: "rgba(127, 188, 255, 0.08)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "rgba(127, 188, 255, 0.08)",
    },
    ".cm-selectionBackground, ::selection": {
      backgroundColor: "rgba(255, 143, 47, 0.25) !important",
    },
    ".cm-content": {
      caretColor: "var(--accent-soft)",
      padding: "0.75rem 0",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--accent-soft)",
    },
    "&.cm-focused": {
      outline: "none",
      borderColor: "var(--accent-soft)",
      boxShadow: "0 0 0 1px rgba(255, 192, 133, 0.2)",
    },
  },
  { dark: true },
);

function languageExtension(language: CodeEditorLanguage) {
  if (language === "cpp") {
    return cpp();
  }
  if (language === "python") {
    return python();
  }
  if (language === "java") {
    return java();
  }
  if (language === "javascript") {
    return javascript();
  }
  return markdown();
}

export function CodeEditor({
  value,
  onChange,
  language,
  minHeight = 260,
}: CodeEditorProps) {
  return (
    <div className="code-editor-shell" style={{ minHeight }}>
      <CodeMirror
        value={value}
        height={`${minHeight}px`}
        theme={editorTheme}
        extensions={[EditorView.lineWrapping, languageExtension(language)]}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: true,
        }}
        onChange={onChange}
      />
    </div>
  );
}
