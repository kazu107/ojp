"use client";
import { useI18n } from "./i18n-provider";
import { useState } from "react";
import {
  DEFAULT_HEURISTIC_CONFIG,
  type HeuristicConfig,
} from "@/lib/heuristic-config";
export function HeuristicSettings({
  value,
  groups,
  onChange,
}: {
  value?: HeuristicConfig;
  groups: string[];
  onChange: (config: HeuristicConfig) => void;
}) {
  const { t } = useI18n();
  const config = value ?? DEFAULT_HEURISTIC_CONFIG;
  const serializedSeeds = JSON.stringify(config.seeds, null, 2);
  const [seedDraft, setSeedDraft] = useState({
    base: serializedSeeds,
    text: serializedSeeds,
    error: "",
  });
  const seedText =
    seedDraft.base === serializedSeeds ? seedDraft.text : serializedSeeds;
  const seedError = seedDraft.base === serializedSeeds ? seedDraft.error : "";
  return (
    <section className="panel stack">
      <h3>{t("Heuristic Scoring")}</h3>
      <p className="text-soft">
        {t(
          "Heuristic scores are not limited to 100 points. Group partial scores are ignored. AC means a valid solution.",
        )}
      </p>
      <div className="form-grid">
        {(
          [
            ["direction", "Optimization Direction", ["maximize", "minimize"]],
            ["evaluation", "Score Evaluation", ["absolute", "relative"]],
            ["aggregate", "Score Aggregation", ["sum", "mean"]],
            [
              "failurePolicy",
              "Failed Case Policy",
              ["case_zero", "submission_zero"],
            ],
            ["visualizer", "Visualizer", ["none", "knapsack", "route"]],
          ] as const
        ).map(([key, label, options]) => (
          <label className="field" key={key}>
            <span className="field-label">{t(label)}</span>
            <select
              className="select"
              value={config[key]}
              onChange={(e) => onChange({ ...config, [key]: e.target.value })}
            >
              {options.map((option) => (
                <option key={option} value={option}>
                  {t(option)}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <h4>{t("System Test Groups")}</h4>
      <p className="text-soft">
        {t(
          "Unchecked groups run during provisional judging; checked groups are reserved for system tests after the contest.",
        )}
      </p>
      {groups.map((name) => (
        <label key={name}>
          <input
            type="checkbox"
            checked={config.finalGroups.includes(name)}
            onChange={(e) =>
              onChange({
                ...config,
                finalGroups: e.target.checked
                  ? [...config.finalGroups, name]
                  : config.finalGroups.filter((n) => n !== name),
              })
            }
          />{" "}
          {name}
        </label>
      ))}
      <label className="field">
        <span>{t("Seed Metadata (JSON)")}</span>
        <textarea
          className="textarea"
          value={seedText}
          onChange={(e) => {
            try {
              const seeds = JSON.parse(e.target.value);
              if (
                !seeds ||
                typeof seeds !== "object" ||
                Array.isArray(seeds) ||
                Object.values(seeds).some((x) => typeof x !== "string")
              )
                throw new Error();
              setSeedDraft({
                base: JSON.stringify(seeds, null, 2),
                text: e.target.value,
                error: "",
              });
              onChange({ ...config, seeds });
            } catch {
              setSeedDraft({
                base: serializedSeeds,
                text: e.target.value,
                error:
                  "Invalid seed JSON; the last valid metadata is retained.",
              });
            }
          }}
        />
      </label>
      {seedError ? <p role="alert">{t(seedError)}</p> : null}
      <p className="text-soft">
        {t(
          "Seeds are imported/exported in config.json. Inputs are generated offline, not by running generators on the web server.",
        )}
      </p>
    </section>
  );
}
