"use client";
import { useI18n } from "@/components/i18n-provider";


import { useEffect, useState } from "react";
import {
  CHECKER_SOURCE_TEMPLATES,
  isDefaultCheckerSourceTemplate,
} from "@/lib/checker-source-templates";
import { INTERACTOR_SOURCE_TEMPLATES, isDefaultInteractorTemplate } from "@/lib/interactor-source-templates";
import { DEFAULT_INTERACTIVE_LIMITS } from "@/lib/interactive-config";
import { CodeEditor } from "@/components/code-editor";
import {
  ProblemPackageCompareMode,
  ProblemPackageCheckerType,
  ProblemPackageEditorDraft,
} from "@/lib/problem-package-types";
import { CheckerLanguage } from "@/lib/types";
import type { Translator } from "@/lib/i18n/shared";

interface ProblemPackageDraftEditorProps {
  draft: ProblemPackageEditorDraft;
  onChange: (next: ProblemPackageEditorDraft) => void;
  onLoadTestCase?: (params: {
    groupId: string;
    groupName: string;
    caseId: string;
    caseName: string;
  }) => Promise<void> | void;
  loadingTestCaseId?: string | null;
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

function scoreSummary(draft: ProblemPackageEditorDraft, t: Translator): {
  label: string;
  badgeClass: string;
} {
  const scores = draft.groups.map((group) => group.score);
  const hasAnyScore = scores.some((score) => score !== null);
  const hasAllScores = scores.every((score) => score !== null);

  if (!hasAnyScore) {
    return {
      label: t("Binary scoring (all groups must pass)"),
      badgeClass: "badge badge-blue",
    };
  }

  if (!hasAllScores) {
    return {
      label: t("Invalid scoring: set all group scores or none"),
      badgeClass: "badge badge-red",
    };
  }

  const total = scores.reduce((acc, score) => acc + (score ?? 0), 0);
  if (total !== 100) {
    return {
      label: t("Partial scoring total={total} (must be 100)", { total }),
      badgeClass: "badge badge-red",
    };
  }

  return {
    label: t("Partial scoring total=100"),
    badgeClass: "badge badge-green",
  };
}

function shouldReplaceCheckerSource(code: string): boolean {
  return code.trim().length === 0 || isDefaultCheckerSourceTemplate(code) || isDefaultInteractorTemplate(code);
}

export function ProblemPackageDraftEditor({
  draft,
  onChange,
  onLoadTestCase,
  loadingTestCaseId,
}: ProblemPackageDraftEditorProps) {
  const { t } = useI18n();
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(
    draft.groups[0]?.id ?? null,
  );
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(
    draft.groups[0]?.tests[0]?.id ?? null,
  );

  const summary = scoreSummary(draft, t);
  const totalCases = draft.groups.reduce((acc, group) => acc + group.tests.length, 0);
  const totalSamples = draft.samples.length;
  const displayedFileCount =
    draft.fileCount > 0
      ? draft.fileCount
      : 2 + (totalSamples + totalCases) * 2 + (draft.checkerType !== "exact" ? 1 : 0);
  const outputLabel =
    draft.checkerType !== "exact" ? "Reference Output" : "Expected Output";

  function patchDraft(
    updater: (current: ProblemPackageEditorDraft) => ProblemPackageEditorDraft,
  ) {
    onChange(updater(draft));
  }

  const activeGroup =
    draft.groups.find((group) => group.id === selectedGroupId) ?? draft.groups[0] ?? null;
  const activeCase =
    activeGroup?.tests.find((testCase) => testCase.id === selectedCaseId) ??
    activeGroup?.tests[0] ??
    null;
  const activeCaseIndex = activeGroup
    ? activeGroup.tests.findIndex((testCase) => testCase.id === activeCase?.id)
    : -1;
  const activeGroupIndex = activeGroup
    ? draft.groups.findIndex((group) => group.id === activeGroup.id)
    : -1;
  const activeCaseIsLoaded = activeCase?.isLoaded !== false;

  useEffect(() => {
    if (!activeGroup || !activeCase || !onLoadTestCase || activeCase.isLoaded !== false) {
      return;
    }

    void onLoadTestCase({
      groupId: activeGroup.id,
      groupName: activeGroup.name,
      caseId: activeCase.id,
      caseName: activeCase.name,
    });
  }, [activeCase, activeGroup, onLoadTestCase]);

  function selectGroup(groupId: string) {
    const nextGroup = draft.groups.find((group) => group.id === groupId);
    setSelectedGroupId(groupId);
    setSelectedCaseId(nextGroup?.tests[0]?.id ?? null);
  }

  function addGroup() {
    const nextGroup = {
      id: createId("group"),
      name: nextGroupName(draft.groups.length),
      score: null,
      tests: [
        {
          id: createId("case"),
          name: "01",
          input: "",
          output: "",
          isLoaded: true,
        },
      ],
    };
    patchDraft((current) => ({
      ...current,
      groups: [...current.groups, nextGroup],
    }));
    setSelectedGroupId(nextGroup.id);
    setSelectedCaseId(nextGroup.tests[0].id);
  }

  function addSample() {
    patchDraft((current) => ({
      ...current,
      samples: [
        ...current.samples,
        {
          id: createId("sample"),
          name: nextSampleName(current.samples.length),
          description: "",
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
    const nextCase = {
      id: createId("case"),
      name: nextCaseName(draft.groups[groupIndex]?.tests.length ?? 0),
      input: "",
      output: "",
      isLoaded: true,
    };
    patchDraft((current) => ({
      ...current,
      groups: current.groups.map((group, index) =>
        index !== groupIndex
          ? group
          : {
              ...group,
              tests: [...group.tests, nextCase],
            },
      ),
    }));
    setSelectedGroupId(draft.groups[groupIndex]?.id ?? null);
    setSelectedCaseId(nextCase.id);
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
          <span className="field-label">{t("Checker Type")}</span>
          <select
            className="select"
            value={draft.checkerType}
            onChange={(event) =>
              patchDraft((current) => ({
                ...current,
                checkerType: event.target.value as ProblemPackageCheckerType,
                checkerSourceCode:
                  event.target.value !== "exact" &&
                  shouldReplaceCheckerSource(current.checkerSourceCode)
                    ? (event.target.value === "interactive" ? INTERACTOR_SOURCE_TEMPLATES : CHECKER_SOURCE_TEMPLATES)[current.checkerLanguage]
                    : current.checkerSourceCode,
              }))
            }
          >
            <option value="exact">{t("exact")}</option>
            <option value="special_judge">{t("special_judge")}</option>
            <option value="interactive">{t("Interactive")}</option>
          </select>
        </label>
        {draft.checkerType !== "exact" ? (
          <label className="field">
            <span className="field-label">{draft.checkerType === "interactive" ? t("Interactor Language") : t("Checker Language")}</span>
            <select
              className="select"
              value={draft.checkerLanguage}
              onChange={(event) =>
                patchDraft((current) => {
                  const nextLanguage = event.target.value as CheckerLanguage;
                  return {
                    ...current,
                    checkerLanguage: nextLanguage,
                    checkerSourceCode: shouldReplaceCheckerSource(current.checkerSourceCode)
                      ? (current.checkerType === "interactive" ? INTERACTOR_SOURCE_TEMPLATES : CHECKER_SOURCE_TEMPLATES)[nextLanguage]
                      : current.checkerSourceCode,
                  };
                })
              }
            >
              <option value="cpp">{t("cpp")}</option>
              <option value="python">{t("python")}</option>
              <option value="java">{t("java")}</option>
              <option value="javascript">{t("javascript")}</option>
            </select>
          </label>
        ) : null}
        <label className="field">
          <span className="field-label">{t("Source Label")}</span>
          <input
            className="input"
            value={draft.sourceLabel}
            onChange={(event) =>
              patchDraft((current) => ({ ...current, sourceLabel: event.target.value }))
            }
            placeholder={t("manual-package")}
          />
        </label>
        <label className="field">
          <span className="field-label">{t("Compare Mode")}</span>
          <select
            className="select"
            value={draft.compareMode}
            disabled={draft.checkerType !== "exact"}
            onChange={(event) =>
              patchDraft((current) => ({
                ...current,
                compareMode: event.target.value as ProblemPackageCompareMode,
              }))
            }
          >
            <option value="exact">{t("exact")}</option>
            <option value="ignore_trailing_spaces">{t("ignore_trailing_spaces")}</option>
          </select>
        </label>
      </div>

      {draft.checkerType !== "exact" ? (
        <div className="stack">
          <p className="text-soft">
            {draft.checkerType === "interactive" ? t("Interactor receives the private input path as argv[1]. Communicate over stdin/stdout and flush each response. Exit 0 for AC, 1 for WA, otherwise IE.") : t("Special judge is called with three arguments: input file path, reference output path, and contestant output path. Exit `0` for AC, `1` for WA, and any other code for judge error.")}</p>
          <div className="field">
            <span className="field-label">{draft.checkerType === "interactive" ? t("Interactor Source Code") : t("Checker Source Code")}</span>
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
        <span className="result-group-meta">{t("Groups: ")}{draft.groups.length}</span>
        <span className="result-group-meta">{t("Cases: ")}{totalCases}</span>
        <span className="result-group-meta">{t("Files: ")}{displayedFileCount}</span>
        <span className="result-group-meta">{t("Samples: ")}{totalSamples}</span>
      </div>
      {draft.isPartial ? (
        <p className="text-soft">
          {t("Large existing packages are loaded lazily. Test case contents are fetched only when selected, and names stay read-only until all cases are loaded.")}</p>
      ) : null}

      {draft.checkerType === "interactive" ? (
        <div className="form-grid">
          {(["idleTimeLimitMs", "wallTimeLimitMs", "interactorTimeLimitMs"] as const).map((key) => (
            <label key={key} className="field">
              <span className="field-label">{t(key)}</span>
              <input className="input" type="number" min={100} max={300000} step={100}
                value={(draft.interactive ?? DEFAULT_INTERACTIVE_LIMITS)[key]}
                onChange={(event) => patchDraft((current) => ({ ...current, interactive: {
                  ...DEFAULT_INTERACTIVE_LIMITS, ...current.interactive, [key]: Number(event.target.value),
                } }))} />
            </label>
          ))}
          <p className="text-soft">{t("Private test inputs are only sent to the interactor. Expected output files are not required.")}</p>
        </div>
      ) : null}

      {draft.warnings.length > 0 ? (
        <div className="package-note-list">
          {draft.warnings.map((warning) => (
            <p key={t(warning)} className="text-soft">
              - {t(warning)}
            </p>
          ))}
        </div>
      ) : null}

      <section className="package-group-editor stack">
        <div className="package-editor-toolbar">
          <h3 className="panel-title">{t("Samples")}</h3>
          <div className="button-row">
            <button type="button" className="button" onClick={addSample}>
              {t("Add Sample")}</button>
          </div>
        </div>

        {draft.samples.length === 0 ? (
          <p className="empty">{t("No samples yet. Add at least one sample if you want examples on the problem page.")}</p>
        ) : (
          draft.samples.map((sample, sampleIndex) => (
            <article key={sample.id} className="package-case-editor stack">
              <div className="package-editor-toolbar">
                <h4 className="field-label">{t("Sample ")}{sampleIndex + 1}</h4>
                <div className="button-row">
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => moveSample(sampleIndex, -1)}
                    disabled={sampleIndex === 0}
                  >
                    {t("Up")}</button>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => moveSample(sampleIndex, 1)}
                    disabled={sampleIndex === draft.samples.length - 1}
                  >
                    {t("Down")}</button>
                  <button
                    type="button"
                    className="button button-danger"
                    onClick={() => removeSample(sampleIndex)}
                    disabled={draft.samples.length === 1}
                  >
                    {t("Remove Sample")}</button>
                </div>
              </div>

              <label className="field">
                <span className="field-label">{t("Sample Name")}</span>
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

              <label className="field">
                <span className="field-label">{t("Sample Description")}</span>
                <textarea
                  className="textarea"
                  value={sample.description}
                  onChange={(event) =>
                    patchDraft((current) => ({
                      ...current,
                      samples: current.samples.map((item, index) =>
                        index !== sampleIndex
                          ? item
                          : {
                              ...item,
                              description: event.target.value,
                            },
                      ),
                    }))
                  }
                />
              </label>

              {draft.checkerType === "interactive" ? (
                <label className="field">
                  <span className="field-label">{t("Sample Interaction")}</span>
                  <textarea className="textarea" value={sample.interaction ?? ""}
                    placeholder={t("Use < for interactor output and > for submission output.")}
                    onChange={(event) => patchDraft((current) => ({ ...current,
                      samples: current.samples.map((item, index) => index === sampleIndex
                        ? { ...item, interaction: event.target.value } : item),
                    }))} />
                </label>
              ) : (
              <div className="form-grid">
                <label className="field">
                  <span className="field-label">{t("Sample Input")}</span>
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
                  <span className="field-label">{t("Sample Output")}</span>
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
              )}
            </article>
          ))
        )}
      </section>

      <section className="package-group-editor stack">
        <div className="package-editor-toolbar">
          <h3 className="panel-title">{t("Groups")}</h3>
          <div className="button-row">
            <button type="button" className="button" onClick={addGroup}>
              {t("Add Group")}</button>
          </div>
        </div>

        {draft.groups.length === 0 ? (
          <p className="empty">{t("No groups yet.")}</p>
        ) : (
          <>
            <div className="field">
              <span className="field-label">{t("Group List")}</span>
              <div className="button-row">
                {draft.groups.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    className={
                      activeGroup?.id === group.id ? "button" : "button button-secondary"
                    }
                    onClick={() => selectGroup(group.id)}
                  >
                    {group.name} ({group.tests.length})
                  </button>
                ))}
              </div>
            </div>

            {activeGroup && activeGroupIndex >= 0 ? (
              <>
                <div className="package-editor-toolbar">
                  <h4 className="field-label">{t("Selected Group")}</h4>
                  <div className="button-row">
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => moveGroup(activeGroupIndex, -1)}
                      disabled={activeGroupIndex === 0}
                    >
                      {t("Up")}</button>
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => moveGroup(activeGroupIndex, 1)}
                      disabled={activeGroupIndex === draft.groups.length - 1}
                    >
                      {t("Down")}</button>
                    <button
                      type="button"
                      className="button button-danger"
                      onClick={() => removeGroup(activeGroupIndex)}
                      disabled={draft.groups.length === 1}
                    >
                      {t("Remove Group")}</button>
                  </div>
                </div>

                <div className="form-grid">
                  <label className="field">
                    <span className="field-label">{t("Group Name")}</span>
                    <input
                      className="input"
                      value={activeGroup.name}
                      disabled={draft.isPartial}
                      onChange={(event) =>
                        patchDraft((current) => ({
                          ...current,
                          groups: current.groups.map((item, index) =>
                            index !== activeGroupIndex
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
                    <span className="field-label">{t("Partial Score")}</span>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      step={1}
                      value={activeGroup.score ?? ""}
                      onChange={(event) => {
                        const value = event.target.value.trim();
                        patchDraft((current) => ({
                          ...current,
                          groups: current.groups.map((item, index) =>
                            index !== activeGroupIndex
                              ? item
                              : {
                                  ...item,
                                  score: value.length === 0 ? null : Number.parseInt(value, 10),
                                },
                          ),
                        }));
                      }}
                      placeholder={t("blank = binary")}
                    />
                  </label>
                </div>

                <div className="field">
                  <span className="field-label">{t("Case List")}</span>
                  <div className="button-row">
                    {activeGroup.tests.map((testCase) => (
                      <button
                        key={testCase.id}
                        type="button"
                        className={
                          activeCase?.id === testCase.id ? "button" : "button button-secondary"
                        }
                        onClick={() => setSelectedCaseId(testCase.id)}
                      >
                        {testCase.name}
                      </button>
                    ))}
                  </div>
                </div>

                {activeCase && activeCaseIndex >= 0 ? (
                  <article key={activeCase.id} className="package-case-editor stack">
                    <div className="package-editor-toolbar">
                      <h4 className="field-label">{t("Selected Case")}</h4>
                      <div className="button-row">
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => moveCase(activeGroupIndex, activeCaseIndex, -1)}
                          disabled={activeCaseIndex === 0}
                        >
                          {t("Up")}</button>
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => moveCase(activeGroupIndex, activeCaseIndex, 1)}
                          disabled={activeCaseIndex === activeGroup.tests.length - 1}
                        >
                          {t("Down")}</button>
                        <button
                          type="button"
                          className="button button-danger"
                          onClick={() => removeCase(activeGroupIndex, activeCaseIndex)}
                          disabled={activeGroup.tests.length === 1}
                        >
                          {t("Remove Case")}</button>
                        <button
                          type="button"
                          className="button"
                          onClick={() => addCase(activeGroupIndex)}
                        >
                          {t("Add Case")}</button>
                      </div>
                    </div>

                    {!activeCaseIsLoaded ? (
                      <p className="badge badge-blue">
                        {loadingTestCaseId === activeCase.id ? t("Loading selected test case...") : t("Loading selected test case on demand...")}
                      </p>
                    ) : null}

                    <label className="field">
                      <span className="field-label">{t("Case Name")}</span>
                      <input
                        className="input"
                        value={activeCase.name}
                        disabled={draft.isPartial}
                        onChange={(event) =>
                          patchDraft((current) => ({
                            ...current,
                            groups: current.groups.map((groupItem, currentGroupIndex) =>
                              currentGroupIndex !== activeGroupIndex
                                ? groupItem
                                : {
                                    ...groupItem,
                                    tests: groupItem.tests.map((caseItem, currentCaseIndex) =>
                                      currentCaseIndex !== activeCaseIndex
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
                        <span className="field-label">{draft.checkerType === "interactive" ? t("Private Test Data") : t("Input")}</span>
                        <textarea
                          className="textarea"
                          value={activeCase.input}
                          disabled={!activeCaseIsLoaded}
                          onChange={(event) =>
                            patchDraft((current) => ({
                              ...current,
                              groups: current.groups.map((groupItem, currentGroupIndex) =>
                                currentGroupIndex !== activeGroupIndex
                                  ? groupItem
                                  : {
                                      ...groupItem,
                                      tests: groupItem.tests.map((caseItem, currentCaseIndex) =>
                                        currentCaseIndex !== activeCaseIndex
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
                      {draft.checkerType !== "interactive" ? (
                      <label className="field">
                        <span className="field-label">{t(outputLabel)}</span>
                        <textarea
                          className="textarea"
                          value={activeCase.output}
                          disabled={!activeCaseIsLoaded}
                          onChange={(event) =>
                            patchDraft((current) => ({
                              ...current,
                              groups: current.groups.map((groupItem, currentGroupIndex) =>
                                currentGroupIndex !== activeGroupIndex
                                  ? groupItem
                                  : {
                                      ...groupItem,
                                      tests: groupItem.tests.map((caseItem, currentCaseIndex) =>
                                        currentCaseIndex !== activeCaseIndex
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
                      ) : null}
                    </div>
                  </article>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
