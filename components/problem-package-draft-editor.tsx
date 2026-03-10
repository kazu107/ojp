"use client";

import { CodeEditor } from "@/components/code-editor";
import {
  ProblemPackageCompareMode,
  ProblemPackageCheckerType,
  ProblemPackageEditorDraft,
} from "@/lib/problem-package-types";
import { Language } from "@/lib/types";

interface ProblemPackageDraftEditorProps {
  draft: ProblemPackageEditorDraft;
  onChange: (next: ProblemPackageEditorDraft) => void;
}

function nextGroupName(groupCount: number): string {
  return `group${groupCount + 1}`;
}

function nextCaseName(caseCount: number): string {
  return String(caseCount + 1).padStart(2, "0");
}

function nextSampleName(sampleCount: number): string {
  return `sample${sampleCount + 1}`;
}

function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function scoreSummary(draft: ProblemPackageEditorDraft): {
  label: string;
  badgeClass: string;
} {
  const scores = draft.groups.map((group) => group.score);
  const hasAnyScore = scores.some((score) => score !== null);
  const hasAllScores = scores.every((score) => score !== null);

  if (!hasAnyScore) {
    return {
      label: "Binary scoring (all groups must pass)",
      badgeClass: "badge badge-blue",
    };
  }

  if (!hasAllScores) {
    return {
      label: "Invalid scoring: set all group scores or none",
      badgeClass: "badge badge-red",
    };
  }

  const total = scores.reduce((acc, score) => acc + (score ?? 0), 0);
  if (total !== 100) {
    return {
      label: `Partial scoring total=${total} (must be 100)`,
      badgeClass: "badge badge-red",
    };
  }

  return {
    label: "Partial scoring total=100",
    badgeClass: "badge badge-green",
  };
}

export function ProblemPackageDraftEditor({
  draft,
  onChange,
}: ProblemPackageDraftEditorProps) {
  const summary = scoreSummary(draft);
  const totalCases = draft.groups.reduce((acc, group) => acc + group.tests.length, 0);
  const totalSamples = draft.samples.length;
  const displayedFileCount =
    draft.fileCount > 0
      ? draft.fileCount
      : 2 + (totalSamples + totalCases) * 2 + (draft.checkerType === "special_judge" ? 1 : 0);
  const outputLabel = draft.checkerType === "special_judge" ? "Reference Output" : "Expected Output";

  function patchDraft(
    updater: (current: ProblemPackageEditorDraft) => ProblemPackageEditorDraft,
  ) {
    onChange(updater(draft));
  }

  function addGroup() {
    patchDraft((current) => ({
      ...current,
      groups: [
        ...current.groups,
        {
          id: createId("group"),
          name: nextGroupName(current.groups.length),
          score: null,
          tests: [
            {
              id: createId("case"),
              name: "01",
              input: "",
              output: "",
            },
          ],
        },
      ],
    }));
  }

  function addSample() {
    patchDraft((current) => ({
      ...current,
      samples: [
        ...current.samples,
        {
          id: createId("sample"),
          name: nextSampleName(current.samples.length),
          input: "",
          output: "",
        },
      ],
    }));
  }

  function moveSample(sampleIndex: number, direction: -1 | 1) {
    patchDraft((current) => {
      const nextIndex = sampleIndex + direction;
      if (nextIndex < 0 || nextIndex >= current.samples.length) {
        return current;
      }
      const samples = [...current.samples];
      const [target] = samples.splice(sampleIndex, 1);
      samples.splice(nextIndex, 0, target);
      return { ...current, samples };
    });
  }

  function removeSample(sampleIndex: number) {
    patchDraft((current) => ({
      ...current,
      samples: current.samples.filter((_, index) => index !== sampleIndex),
    }));
  }

  function moveGroup(groupIndex: number, direction: -1 | 1) {
    patchDraft((current) => {
      const nextIndex = groupIndex + direction;
      if (nextIndex < 0 || nextIndex >= current.groups.length) {
        return current;
      }
      const groups = [...current.groups];
      const [target] = groups.splice(groupIndex, 1);
      groups.splice(nextIndex, 0, target);
      return { ...current, groups };
    });
  }

  function removeGroup(groupIndex: number) {
    patchDraft((current) => ({
      ...current,
      groups: current.groups.filter((_, index) => index !== groupIndex),
    }));
  }

  function addCase(groupIndex: number) {
    patchDraft((current) => ({
      ...current,
      groups: current.groups.map((group, index) =>
        index !== groupIndex
          ? group
          : {
              ...group,
              tests: [
                ...group.tests,
                {
                  id: createId("case"),
                  name: nextCaseName(group.tests.length),
                  input: "",
                  output: "",
                },
              ],
            },
      ),
    }));
  }

  function moveCase(groupIndex: number, caseIndex: number, direction: -1 | 1) {
    patchDraft((current) => ({
      ...current,
      groups: current.groups.map((group, index) => {
        if (index !== groupIndex) {
          return group;
        }
        const nextIndex = caseIndex + direction;
        if (nextIndex < 0 || nextIndex >= group.tests.length) {
          return group;
        }
        const tests = [...group.tests];
        const [target] = tests.splice(caseIndex, 1);
        tests.splice(nextIndex, 0, target);
        return { ...group, tests };
      }),
    }));
  }

  function removeCase(groupIndex: number, caseIndex: number) {
    patchDraft((current) => ({
      ...current,
      groups: current.groups.map((group, index) =>
        index !== groupIndex
          ? group
          : {
              ...group,
              tests: group.tests.filter((_, testIndex) => testIndex !== caseIndex),
            },
      ),
    }));
  }

  return (
    <div className="stack">
      <div className="form-grid">
        <label className="field">
          <span className="field-label">Checker Type</span>
          <select
            className="select"
            value={draft.checkerType}
            onChange={(event) =>
              patchDraft((current) => ({
                ...current,
                checkerType: event.target.value as ProblemPackageCheckerType,
              }))
            }
          >
            <option value="exact">exact</option>
            <option value="special_judge">special_judge</option>
          </select>
        </label>
        {draft.checkerType === "special_judge" ? (
          <label className="field">
            <span className="field-label">Checker Language</span>
            <select
              className="select"
              value={draft.checkerLanguage}
              onChange={(event) =>
                patchDraft((current) => ({
                  ...current,
                  checkerLanguage: event.target.value as Language,
                }))
              }
            >
              <option value="cpp">cpp</option>
              <option value="python">python</option>
              <option value="java">java</option>
              <option value="javascript">javascript</option>
            </select>
          </label>
        ) : null}
        <label className="field">
          <span className="field-label">Source Label</span>
          <input
            className="input"
            value={draft.sourceLabel}
            onChange={(event) =>
              patchDraft((current) => ({ ...current, sourceLabel: event.target.value }))
            }
            placeholder="manual-package"
          />
        </label>
        <label className="field">
          <span className="field-label">Compare Mode</span>
          <select
            className="select"
            value={draft.compareMode}
            disabled={draft.checkerType === "special_judge"}
            onChange={(event) =>
              patchDraft((current) => ({
                ...current,
                compareMode: event.target.value as ProblemPackageCompareMode,
              }))
            }
          >
            <option value="exact">exact</option>
            <option value="ignore_trailing_spaces">ignore_trailing_spaces</option>
          </select>
        </label>
      </div>

      {draft.checkerType === "special_judge" ? (
        <div className="stack">
          <p className="text-soft">
            Special judge is called with three arguments: input file path, reference output path,
            and contestant output path. Exit `0` for AC, `1` for WA, and any other code for judge
            error.
          </p>
          <div className="field">
            <span className="field-label">Checker Source Code</span>
            <CodeEditor
              language={draft.checkerLanguage}
              minHeight={220}
              value={draft.checkerSourceCode}
              onChange={(value) =>
                patchDraft((current) => ({
                  ...current,
                  checkerSourceCode: value,
                }))
              }
            />
          </div>
        </div>
      ) : null}

      <div className="meta-inline">
        <span className={summary.badgeClass}>{summary.label}</span>
        <span className="result-group-meta">Groups: {draft.groups.length}</span>
        <span className="result-group-meta">Cases: {totalCases}</span>
        <span className="result-group-meta">Files: {displayedFileCount}</span>
        <span className="result-group-meta">Samples: {totalSamples}</span>
      </div>

      {draft.warnings.length > 0 ? (
        <div className="package-note-list">
          {draft.warnings.map((warning) => (
            <p key={warning} className="text-soft">
              - {warning}
            </p>
          ))}
        </div>
      ) : null}

      <section className="package-group-editor stack">
        <div className="package-editor-toolbar">
          <h3 className="panel-title">Samples</h3>
          <div className="button-row">
            <button type="button" className="button" onClick={addSample}>
              Add Sample
            </button>
          </div>
        </div>

        {draft.samples.length === 0 ? (
          <p className="empty">No samples yet. Add at least one sample if you want examples on the problem page.</p>
        ) : (
          draft.samples.map((sample, sampleIndex) => (
            <article key={sample.id} className="package-case-editor stack">
              <div className="package-editor-toolbar">
                <h4 className="field-label">Sample {sampleIndex + 1}</h4>
                <div className="button-row">
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => moveSample(sampleIndex, -1)}
                    disabled={sampleIndex === 0}
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => moveSample(sampleIndex, 1)}
                    disabled={sampleIndex === draft.samples.length - 1}
                  >
                    Down
                  </button>
                  <button
                    type="button"
                    className="button button-danger"
                    onClick={() => removeSample(sampleIndex)}
                    disabled={draft.samples.length === 1}
                  >
                    Remove Sample
                  </button>
                </div>
              </div>

              <label className="field">
                <span className="field-label">Sample Name</span>
                <input
                  className="input"
                  value={sample.name}
                  onChange={(event) =>
                    patchDraft((current) => ({
                      ...current,
                      samples: current.samples.map((item, index) =>
                        index !== sampleIndex
                          ? item
                          : {
                              ...item,
                              name: event.target.value,
                            },
                      ),
                    }))
                  }
                />
              </label>

              <div className="form-grid">
                <label className="field">
                  <span className="field-label">Sample Input</span>
                  <textarea
                    className="textarea"
                    value={sample.input}
                    onChange={(event) =>
                      patchDraft((current) => ({
                        ...current,
                        samples: current.samples.map((item, index) =>
                          index !== sampleIndex
                            ? item
                            : {
                                ...item,
                                input: event.target.value,
                              },
                        ),
                      }))
                    }
                  />
                </label>
                <label className="field">
                  <span className="field-label">Sample Output</span>
                  <textarea
                    className="textarea"
                    value={sample.output}
                    onChange={(event) =>
                      patchDraft((current) => ({
                        ...current,
                        samples: current.samples.map((item, index) =>
                          index !== sampleIndex
                            ? item
                            : {
                                ...item,
                                output: event.target.value,
                              },
                        ),
                      }))
                    }
                  />
                </label>
              </div>
            </article>
          ))
        )}
      </section>

      {draft.groups.map((group, groupIndex) => (
        <section key={group.id} className="package-group-editor stack">
          <div className="package-editor-toolbar">
            <h3 className="panel-title">Group {groupIndex + 1}</h3>
            <div className="button-row">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => moveGroup(groupIndex, -1)}
                disabled={groupIndex === 0}
              >
                Up
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => moveGroup(groupIndex, 1)}
                disabled={groupIndex === draft.groups.length - 1}
              >
                Down
              </button>
              <button
                type="button"
                className="button button-danger"
                onClick={() => removeGroup(groupIndex)}
                disabled={draft.groups.length === 1}
              >
                Remove Group
              </button>
            </div>
          </div>

          <div className="form-grid">
            <label className="field">
              <span className="field-label">Group Name</span>
              <input
                className="input"
                value={group.name}
                onChange={(event) =>
                  patchDraft((current) => ({
                    ...current,
                    groups: current.groups.map((item, index) =>
                      index !== groupIndex
                        ? item
                        : {
                            ...item,
                            name: event.target.value,
                          },
                    ),
                  }))
                }
              />
            </label>
            <label className="field">
              <span className="field-label">Partial Score</span>
              <input
                className="input"
                type="number"
                min={0}
                step={1}
                value={group.score ?? ""}
                onChange={(event) => {
                  const value = event.target.value.trim();
                  patchDraft((current) => ({
                    ...current,
                    groups: current.groups.map((item, index) =>
                      index !== groupIndex
                        ? item
                        : {
                            ...item,
                            score: value.length === 0 ? null : Number.parseInt(value, 10),
                          },
                    ),
                  }));
                }}
                placeholder="blank = binary"
              />
            </label>
          </div>

          {group.tests.map((testCase, caseIndex) => (
            <article key={testCase.id} className="package-case-editor stack">
              <div className="package-editor-toolbar">
                <h4 className="field-label">Case {caseIndex + 1}</h4>
                <div className="button-row">
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => moveCase(groupIndex, caseIndex, -1)}
                    disabled={caseIndex === 0}
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => moveCase(groupIndex, caseIndex, 1)}
                    disabled={caseIndex === group.tests.length - 1}
                  >
                    Down
                  </button>
                  <button
                    type="button"
                    className="button button-danger"
                    onClick={() => removeCase(groupIndex, caseIndex)}
                    disabled={group.tests.length === 1}
                  >
                    Remove Case
                  </button>
                </div>
              </div>

              <label className="field">
                <span className="field-label">Case Name</span>
                <input
                  className="input"
                  value={testCase.name}
                  onChange={(event) =>
                    patchDraft((current) => ({
                      ...current,
                      groups: current.groups.map((groupItem, currentGroupIndex) =>
                        currentGroupIndex !== groupIndex
                          ? groupItem
                          : {
                              ...groupItem,
                              tests: groupItem.tests.map((caseItem, currentCaseIndex) =>
                                currentCaseIndex !== caseIndex
                                  ? caseItem
                                  : {
                                      ...caseItem,
                                      name: event.target.value,
                                    },
                              ),
                            },
                      ),
                    }))
                  }
                />
              </label>

              <div className="form-grid">
                <label className="field">
                  <span className="field-label">Input</span>
                  <textarea
                    className="textarea"
                    value={testCase.input}
                    onChange={(event) =>
                      patchDraft((current) => ({
                        ...current,
                        groups: current.groups.map((groupItem, currentGroupIndex) =>
                          currentGroupIndex !== groupIndex
                            ? groupItem
                            : {
                                ...groupItem,
                                tests: groupItem.tests.map((caseItem, currentCaseIndex) =>
                                  currentCaseIndex !== caseIndex
                                    ? caseItem
                                    : {
                                        ...caseItem,
                                        input: event.target.value,
                                      },
                                ),
                              },
                        ),
                      }))
                    }
                  />
                </label>
                <label className="field">
                  <span className="field-label">{outputLabel}</span>
                  <textarea
                    className="textarea"
                    value={testCase.output}
                    onChange={(event) =>
                      patchDraft((current) => ({
                        ...current,
                        groups: current.groups.map((groupItem, currentGroupIndex) =>
                          currentGroupIndex !== groupIndex
                            ? groupItem
                            : {
                                ...groupItem,
                                tests: groupItem.tests.map((caseItem, currentCaseIndex) =>
                                  currentCaseIndex !== caseIndex
                                    ? caseItem
                                    : {
                                        ...caseItem,
                                        output: event.target.value,
                                      },
                                ),
                              },
                        ),
                      }))
                    }
                  />
                </label>
              </div>
            </article>
          ))}

          <div className="button-row">
            <button
              type="button"
              className="button"
              onClick={() => addCase(groupIndex)}
            >
              Add Case
            </button>
          </div>
        </section>
      ))}

      <div className="button-row">
        <button type="button" className="button" onClick={addGroup}>
          Add Group
        </button>
      </div>
    </div>
  );
}
