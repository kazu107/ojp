import type { ProblemPackageEditorDraft } from "./problem-package-types";

export function validateRecoveryPackage(value: ProblemPackageEditorDraft | null): ProblemPackageEditorDraft | null {
  if (!value) return null;
  if (!["exact", "special_judge", "interactive"].includes(value.checkerType) || typeof value.checkerSourceCode !== "string" || !Array.isArray(value.groups) || !Array.isArray(value.samples)) throw new Error("Invalid local draft.");
  for (const group of value.groups) {
    if (typeof group.id !== "string" || typeof group.name !== "string" || !Array.isArray(group.tests)) throw new Error("Invalid local draft.");
    for (const test of group.tests) if (typeof test.id !== "string" || typeof test.name !== "string" || typeof test.input !== "string" || typeof test.output !== "string") throw new Error("Invalid local draft.");
  }
  for (const sample of value.samples) if (typeof sample.name !== "string" || typeof sample.input !== "string" || typeof sample.output !== "string" || typeof sample.description !== "string") throw new Error("Invalid local draft.");
  return { ...value, warnings: Array.isArray(value.warnings) ? value.warnings.filter(item => typeof item === "string") : [], sourceLabel: typeof value.sourceLabel === "string" ? value.sourceLabel : "recovered-package" };
}

// Do not duplicate ZIPs or large test files in browser recovery storage.
export function recoverablePackage(draft: ProblemPackageEditorDraft | null): ProblemPackageEditorDraft | null {
  if (!draft) return null;
  let remaining = 512 * 1024;
  let partial = Boolean(draft.isPartial);
  let omitted = Boolean(draft.recoveryNeedsReimport);
  return { ...draft, samples: draft.samples.map((sample) => {
    if (sample.input.length + sample.output.length + (sample.interaction?.length ?? 0) > remaining) { partial = true; omitted = true; return { ...sample, input: "", output: "", interaction: undefined, isLoaded: false }; }
    const size = new TextEncoder().encode(JSON.stringify(sample)).length;
    if (size > remaining) { partial = true; omitted = true; return { ...sample, input: "", output: "", interaction: undefined, isLoaded: false }; }
    remaining -= size; return sample;
  }), groups: draft.groups.map((group) => ({ ...group, tests: group.tests.map((test) => {
    if (test.input.length + test.output.length > remaining) { partial = true; omitted = true; return { ...test, input: "", output: "", isLoaded: false }; }
    const size = new TextEncoder().encode(test.input).length + new TextEncoder().encode(test.output).length;
    if (size > remaining || test.isLoaded === false) { partial = true; if (size > remaining) omitted = true; return { ...test, input: "", output: "", isLoaded: false }; }
    remaining -= size; return test;
  }) })), get isPartial() { return partial; }, get recoveryNeedsReimport() { return omitted; } };
}

export function mergeRecoveredPackage(recovered: ProblemPackageEditorDraft, original: ProblemPackageEditorDraft): ProblemPackageEditorDraft {
  const groups = recovered.groups.map(group => ({ ...group, tests: group.tests.map(test => {
    if (test.isLoaded !== false) return test;
    const source = original.groups.find(item => item.name === group.name)?.tests.find(item => item.name === test.name);
    if (!source) throw new Error("The ZIP does not contain all recovered cases.");
    return { ...test, input: source.input, output: source.output, isLoaded: true };
  }) }));
  const samples = recovered.samples.map(sample => {
    if (sample.isLoaded !== false) return sample;
    const source = original.samples.find(item => item.name === sample.name);
    if (!source) throw new Error("The ZIP does not contain all recovered samples.");
    return { ...source, id: sample.id, description: sample.description };
  });
  return { ...recovered, samples, groups, isPartial: false, recoveryNeedsReimport: false };
}
