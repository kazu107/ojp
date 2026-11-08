"use client";
import { useState } from "react";
import { parseVisualization } from "@/lib/heuristic-visualization";
import { useI18n } from "./i18n-provider";
export function HeuristicVisualizer({
  kind,
  sampleInput,
  sampleOutput,
}: {
  kind: "knapsack" | "route";
  sampleInput: string;
  sampleOutput: string;
}) {
  const { t } = useI18n();
  const [input, setInput] = useState(sampleInput),
    [output, setOutput] = useState(sampleOutput),
    [comparison, setComparison] = useState("");
  function diagram(text: string, color: string) {
    try {
      const data = parseVisualization(kind, input, text);
      const maxX = Math.max(1, ...data.points.map((p) => p.x)),
        maxY = Math.max(1, ...data.points.map((p) => p.y));
      return (
        <div className="stack">
          <p>
            {t("Raw Score")}: <strong>{data.score}</strong>
            {kind === "knapsack"
              ? ` / ${t("Weight")}: ${data.weight} / ${t("Capacity")}: ${data.capacity}`
              : ""}
          </p>
          {kind === "route" ? (
            <svg
              viewBox="0 0 420 300"
              role="img"
              aria-label={t("Route Visualization")}
              style={{ width: "100%", maxWidth: 600, background: "#10243a" }}
            >
              <polyline
                points={[...data.answer, data.answer[0]]
                  .map(
                    (i) =>
                      `${20 + (data.points[i].x / maxX) * 380},${20 + (data.points[i].y / maxY) * 250}`,
                  )
                  .join(" ")}
                fill="none"
                stroke={color}
                strokeWidth="2"
              />
              {data.points.map((p, i) => (
                <g key={i}>
                  <circle
                    cx={20 + (p.x / maxX) * 380}
                    cy={20 + (p.y / maxY) * 250}
                    r="4"
                    fill="#fff"
                  />
                  <text
                    x={25 + (p.x / maxX) * 380}
                    y={20 + (p.y / maxY) * 250}
                    fill="#fff"
                    fontSize="10"
                  >
                    {i}
                  </text>
                </g>
              ))}
            </svg>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(90px,1fr))",
                gap: 8,
              }}
            >
              {data.items.map((x, i) => (
                <div
                  key={i}
                  className="panel"
                  style={{
                    borderColor: x.selected ? color : undefined,
                    padding: 8,
                  }}
                >
                  {i}: {x.selected ? "1" : "0"}
                  <br />
                  {t("Weight")}: {x.weight}
                  <br />
                  {t("Value")}: {x.value}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    } catch (error) {
      return (
        <p role="status">
          {t(error instanceof Error ? error.message : "Invalid output")}
        </p>
      );
    }
  }
  return (
    <section className="panel stack">
      <h2 className="panel-title">{t("Visualizer")}</h2>
      <p className="text-soft">
        {t(
          "Visualization runs locally using samples or your own input and output. Private judge inputs are never loaded here.",
        )}
      </p>
      <label className="field">
        {t("Input")}
        <textarea
          className="textarea"
          maxLength={65536}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
      </label>
      <label className="field">
        {t("Output")}
        <textarea
          className="textarea"
          maxLength={65536}
          value={output}
          onChange={(e) => setOutput(e.target.value)}
        />
      </label>
      {diagram(output, "#60d2ad")}
      <details>
        <summary>{t("Compare Another Output")}</summary>
        <textarea
          className="textarea"
          aria-label={t("Comparison Output")}
          maxLength={65536}
          value={comparison}
          onChange={(e) => setComparison(e.target.value)}
        />
        {comparison ? diagram(comparison, "#ffb15c") : null}
      </details>
    </section>
  );
}
