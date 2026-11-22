"use client";
import { useEffect, useMemo, useState } from "react";
import {
  parseBoardConfig,
  parseBoardReplay,
  type BoardConfig,
  type BoardReplay,
  type GridGameConfig,
  type BoardPiece,
} from "@/lib/board-visualization";
import { useI18n } from "./i18n-provider";

export function BoardPlayer({
  replay,
  config,
  autoPlay = false,
}: {
  replay: BoardReplay;
  config: BoardConfig;
  autoPlay?: boolean;
}) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1),
    [zoom, setZoom] = useState(1);
  const selected = Math.min(index, replay.frames.length - 1),
    frame = replay.frames[selected];
  useEffect(() => {
    if (!autoPlay) return;
    const frame = requestAnimationFrame(() => {
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches)
        setPlaying(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [autoPlay]);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      if (document.hidden) return;
      const next = Math.min(selected + 1, replay.frames.length - 1);
      setIndex(next);
      if (next === replay.frames.length - 1) setPlaying(false);
    }, 400 / speed);
    return () => clearInterval(timer);
  }, [playing, speed, replay.frames.length, selected]);
  let grid = replay.board;
  const cleared = new Set<string>();
  for (const previous of replay.frames.slice(0, selected + 1)) {
    if (previous.board) {
      grid = previous.board;
      cleared.clear();
    }
    previous.cleared.forEach((p) => cleared.add(`${p.x},${p.y}`));
  }
  const columns = Array.from(grid[0]).length,
    rows = grid.length,
    cell = 28,
    pad = config.coordinates ? 24 : 6;
  const symbols = new Map(
    config.symbols.map((symbol) => [symbol.symbol, symbol]),
  );
  const width = columns * cell + pad * 2,
    height = rows * cell + pad * 2;
  const contrast = (color: string) => {
    const rgb = parseInt(color.slice(1), 16);
    return ((rgb >> 16) * 299 + ((rgb >> 8) & 255) * 587 + (rgb & 255) * 114) /
      1000 >
      150
      ? "#0b1420"
      : "#edf4ff";
  };
  const drawPiece = (piece: BoardPiece, key: string) => {
    const x = pad + piece.x * cell + cell / 2,
      y = pad + piece.y * cell + cell / 2;
    return (
      <g key={key}>
        {piece.shape === "circle" ? (
          <circle cx={x} cy={y} r={10} fill={piece.color} />
        ) : piece.shape === "diamond" ? (
          <polygon
            points={`${x},${y - 10} ${x + 10},${y} ${x},${y + 10} ${x - 10},${y}`}
            fill={piece.color}
          />
        ) : (
          <rect
            x={x - 11}
            y={y - 11}
            width={22}
            height={22}
            rx={3}
            fill={piece.color}
          />
        )}
        <text
          x={x}
          y={y + 4}
          textAnchor="middle"
          fontSize={12}
          fill={contrast(piece.color)}
          fontWeight="700"
        >
          {piece.glyph}
        </text>
      </g>
    );
  };
  return (
    <div className="board-player stack">
      <div className="board-viewport">
        <svg
          role="img"
          aria-label={t("Board visualization")}
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: `${zoom * 100}%`, maxWidth: "none", minWidth: 200 }}
        >
          <title>{t("Board visualization")}</title>
          {grid.flatMap((row, y) =>
            Array.from(row).map((raw, x) => {
              const symbol = cleared.has(`${x},${y}`) ? "." : raw,
                style = symbols.get(symbol);
              return (
                <g key={`${x},${y}`}>
                  <rect
                    x={pad + x * cell}
                    y={pad + y * cell}
                    width={cell}
                    height={cell}
                    fill={style?.shape === "tile" ? style.color : "#142334"}
                    stroke="#304156"
                    strokeWidth={0.7}
                  />
                  {style?.shape !== "tile" && style ? (
                    drawPiece(
                      {
                        id: "tile",
                        x,
                        y,
                        color: style.color,
                        glyph: style.glyph,
                        shape: style.shape,
                      },
                      "piece",
                    )
                  ) : style?.glyph ? (
                    <text
                      x={pad + x * cell + 14}
                      y={pad + y * cell + 19}
                      textAnchor="middle"
                      fontSize={13}
                      fill={contrast(style.color)}
                    >
                      {style.glyph}
                    </text>
                  ) : !style ? (
                    <text
                      x={pad + x * cell + 14}
                      y={pad + y * cell + 18}
                      textAnchor="middle"
                      fontSize={12}
                      fill="#a6b5c9"
                    >
                      {symbol}
                    </text>
                  ) : null}
                </g>
              );
            }),
          )}
          {config.trail ? (
            <polyline
              points={replay.frames
                .slice(0, selected + 1)
                .flatMap((f) =>
                  f.pieces
                    .filter((p) => p.id === "player")
                    .map(
                      (p) =>
                        `${pad + p.x * cell + 14},${pad + p.y * cell + 14}`,
                    ),
                )
                .join(" ")}
              fill="none"
              stroke="#f3a45d"
              strokeWidth={3}
              opacity={0.5}
            />
          ) : null}
          {frame.paths?.map((path, i) => (
            <polyline
              key={i}
              points={path
                .map((p) => `${pad + p.x * cell + 14},${pad + p.y * cell + 14}`)
                .join(" ")}
              fill="none"
              stroke="#7fbcff"
              strokeWidth={3}
            />
          ))}
          {frame.pieces.map((piece) => drawPiece(piece, piece.id))}
          {config.coordinates
            ? Array.from({ length: columns }, (_, x) => (
                <text
                  key={`x${x}`}
                  x={pad + x * cell + 14}
                  y={15}
                  textAnchor="middle"
                  fontSize={10}
                  fill="#a6b5c9"
                >
                  {x}
                </text>
              ))
            : null}
          {config.coordinates
            ? Array.from({ length: rows }, (_, y) => (
                <text
                  key={`y${y}`}
                  x={10}
                  y={pad + y * cell + 18}
                  textAnchor="middle"
                  fontSize={10}
                  fill="#a6b5c9"
                >
                  {y}
                </text>
              ))
            : null}
        </svg>
      </div>
      <div className="board-controls">
        <button
          className="button"
          type="button"
          disabled={replay.frames.length < 2}
          onClick={() => {
            if (selected === replay.frames.length - 1) setIndex(0);
            setPlaying(!playing);
          }}
        >
          {t(playing ? "Pause replay" : "Play replay")}
        </button>
        <button
          className="button button-secondary"
          type="button"
          disabled={selected === 0}
          onClick={() => {
            setPlaying(false);
            setIndex(selected - 1);
          }}
        >
          {t("Previous frame")}
        </button>
        <button
          className="button button-secondary"
          type="button"
          disabled={selected === replay.frames.length - 1}
          onClick={() => {
            setPlaying(false);
            setIndex(selected + 1);
          }}
        >
          {t("Next frame")}
        </button>
        <label>
          {t("Speed")}
          <select
            className="select"
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          >
            {[0.5, 1, 2, 4].map((value) => (
              <option key={value} value={value}>
                {value}
                {t("x")}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Zoom")}
          <select
            className="select"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          >
            {[0.75, 1, 1.5, 2].map((value) => (
              <option key={value} value={value}>
                {value * 100}%
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span className="field-label">
          {t("Frame")} {selected} / {replay.frames.length - 1} {frame.label}
        </span>
        <input
          aria-label={t("Replay position")}
          type="range"
          min={0}
          max={replay.frames.length - 1}
          value={selected}
          onChange={(e) => {
            setPlaying(false);
            setIndex(Number(e.target.value));
          }}
        />
      </label>
      {replay.message ? (
        <p role="status">
          {t("Final result")}: {t(replay.message)}
          {replay.score != null ? ` / ${t("Raw Score")}: ${replay.score}` : ""}
        </p>
      ) : null}
      <div className="board-legend">
        {config.symbols.map((symbol) => (
          <span key={symbol.symbol}>
            <i style={{ backgroundColor: symbol.color }} />
            {symbol.symbol}: {symbol.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function BoardVisualizer({
  config,
  game,
  sampleInput,
  sampleOutput,
  onUseSample,
}: {
  config: BoardConfig;
  game?: GridGameConfig;
  sampleInput: string;
  sampleOutput: string;
  onUseSample?: (input: string, output: string) => void;
}) {
  const { t } = useI18n();
  const initialInput = sampleInput.slice(0, 8193),
    initialOutput = sampleOutput.slice(0, 262145);
  const [sampleBase, setSampleBase] = useState({
    input: initialInput,
    output: initialOutput,
  });
  const [input, setInput] = useState(initialInput),
    [output, setOutput] = useState(initialOutput),
    [comparison, setComparison] = useState("");
  const [applied, setApplied] = useState({
    input,
    output,
    comparison: "",
    version: 0,
  });
  // Importing a different package replaces preview data; palette edits do not.
  if (
    sampleBase.input !== initialInput ||
    sampleBase.output !== initialOutput
  ) {
    setSampleBase({ input: initialInput, output: initialOutput });
    setInput(initialInput);
    setOutput(initialOutput);
    setComparison("");
    setApplied({
      input: initialInput,
      output: initialOutput,
      comparison: "",
      version: applied.version + 1,
    });
  }
  const data = useMemo(() => {
    try {
      const safe = parseBoardConfig(config);
      return {
        config: safe,
        replay: parseBoardReplay(applied.input, applied.output, safe, game),
        comparison: applied.comparison
          ? parseBoardReplay(applied.input, applied.comparison, safe, game)
          : null,
        error: "",
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Invalid replay",
      };
    }
  }, [applied, config, game]);
  return (
    <section className="panel stack">
      <h2 className="panel-title">{t("Board visualizer")}</h2>
      <p className="text-soft">
        {t(
          "Use public samples or your own data. Private judge inputs and replays are never loaded here.",
        )}
      </p>
      <div className="form-grid">
        <label className="field">
          {t("Board input")}
          <textarea
            className="textarea code-block"
            value={input}
            maxLength={8192}
            onChange={(e) => setInput(e.target.value)}
          />
        </label>
        <label className="field">
          {t("Actions or replay JSON")}
          <textarea
            className="textarea code-block"
            value={output}
            maxLength={262144}
            onChange={(e) => setOutput(e.target.value)}
          />
        </label>
      </div>
      <details>
        <summary>{t("Compare Another Output")}</summary>
        <label className="field">
          {t("Comparison Output")}
          <textarea
            className="textarea code-block"
            value={comparison}
            maxLength={262144}
            onChange={(e) => setComparison(e.target.value)}
          />
        </label>
      </details>
      <div className="button-row">
        <button
          className="button"
          type="button"
          onClick={() =>
            setApplied({
              input,
              output,
              comparison,
              version: applied.version + 1,
            })
          }
        >
          {t("Update board preview")}
        </button>
        {onUseSample ? (
          <button
            className="button button-secondary"
            type="button"
            onClick={() => {
              try {
                parseBoardReplay(input, output, parseBoardConfig(config), game);
                onUseSample(input, output);
              } catch {
                setApplied({
                  input,
                  output,
                  comparison,
                  version: applied.version + 1,
                });
              }
            }}
          >
            {t("Use as first public sample")}
          </button>
        ) : null}
      </div>
      {data.error ? (
        <p role="alert" className="text-soft">
          {t(data.error)}
        </p>
      ) : data.replay && data.config ? (
        <div className={data.comparison ? "board-comparison" : ""}>
          <BoardPlayer
            key={`main-${applied.version}`}
            replay={data.replay}
            config={data.config}
          />
          {data.comparison ? (
            <BoardPlayer
              key={`other-${applied.version}`}
              replay={data.comparison}
              config={data.config}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
