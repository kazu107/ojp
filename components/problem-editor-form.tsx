"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CodeEditor } from "@/components/code-editor";
import { MarkdownBlock } from "@/components/markdown-block";
import { ProblemPackageDraftEditor } from "@/components/problem-package-draft-editor";
import { CHECKER_SOURCE_TEMPLATES } from "@/lib/checker-source-templates";
import { inspectProblemPackageClient } from "@/lib/problem-package-client-inspect";
import { buildProblemPackageZipBlob } from "@/lib/problem-package-client-zip";
import { StatusBadge } from "@/components/status-badge";
import { badgeClassForSubmission, submissionStatusLabel } from "@/lib/presentation";
import { SOURCE_CODE_TEMPLATES } from "@/lib/source-code-templates";
import { pickHighestPriorityVerdict } from "@/lib/submission-status";
import {
  ExplanationVisibility,
  Language,
  Problem,
  Submission,
  SubmissionStatus,
  TestCaseVisibility,
  Visibility,
} from "@/lib/types";
import {
  ProblemPackageEditorDraft,
} from "@/lib/problem-package-types";

type ProblemEditorFormProps =
  | {
      mode: "create";
      initialProblem?: undefined;
      initialPackageDraft?: ProblemPackageEditorDraft | null;
    }
  | {
      mode: "edit";
      initialProblem: Problem;
      initialPackageDraft?: ProblemPackageEditorDraft | null;
    };

type EditorTab = "content" | "settings" | "tests" | "testrun";

interface FormState {
  title: string;
  slug: string;
  statementMarkdown: string;
  inputDescription: string;
  outputDescription: string;
  constraintsMarkdown: string;
  explanationMarkdown: string;
  explanationVisibility: ExplanationVisibility;
  visibility: Visibility;
  difficulty: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  testCaseVisibility: TestCaseVisibility;
}

interface PackageTestPreviewResult {
  status: SubmissionStatus;
  score: number;
  totalTimeMs: number;
  peakMemoryKb: number;
  testResults: Submission["testResults"];
}

interface UploadedPackageRef {
  provider: "r2";
  bucket: string;
  key: string;
  uploadedAt: string;
  sizeBytes: number;
  etag: string | null;
}

interface PackageJobEnvelope {
  job: {
    id: string;
    type: "apply" | "preview";
    status: "queued" | "running" | "completed" | "failed";
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    error: string | null;
    result: unknown;
  };
}

interface ActionProgressState {
  phase: string;
  percent: number;
}

interface PreviewGroupedTestResults {
  groupName: string;
  verdict: SubmissionStatus;
  caseCount: number;
  maxTimeMs: number;
  peakMemoryKb: number;
  cases: Submission["testResults"];
}

function groupPreviewResults(
  results: Submission["testResults"],
): PreviewGroupedTestResults[] {
  const grouped = new Map<string, Submission["testResults"]>();
  for (const result of results) {
    const entries = grouped.get(result.groupName) ?? [];
    entries.push(result);
    grouped.set(result.groupName, entries);
  }

  return [...grouped.entries()].map(([groupName, cases]) => ({
    groupName,
    verdict: pickHighestPriorityVerdict(cases.map((entry) => entry.verdict)),
    caseCount: cases.length,
    maxTimeMs: cases.reduce((max, entry) => Math.max(max, entry.timeMs), 0),
    peakMemoryKb: cases.reduce((max, entry) => Math.max(max, entry.memoryKb), 0),
    cases,
  }));
}

function emptyState(): FormState {
  return {
    title: "",
    slug: "",
    statementMarkdown: "",
    inputDescription: "",
    outputDescription: "",
    constraintsMarkdown: "",
    explanationMarkdown: "",
    explanationVisibility: "private",
    visibility: "public",
    difficulty: "",
    timeLimitMs: 2000,
    memoryLimitMb: 512,
    testCaseVisibility: "case_index_only",
  };
}

function stateFromProblem(problem: Problem): FormState {
  return {
    title: problem.title,
    slug: problem.slug,
    statementMarkdown: problem.statementMarkdown,
    inputDescription: problem.inputDescription,
    outputDescription: problem.outputDescription,
    constraintsMarkdown: problem.constraintsMarkdown,
    explanationMarkdown: problem.explanationMarkdown,
    explanationVisibility: problem.explanationVisibility,
    visibility: problem.visibility,
    difficulty: problem.difficulty === null ? "" : String(problem.difficulty),
    timeLimitMs: problem.timeLimitMs,
    memoryLimitMb: problem.memoryLimitMb,
    testCaseVisibility: problem.testCaseVisibility,
  };
}

function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function createBlankPackageDraft(): ProblemPackageEditorDraft {
  return {
    sourceLabel: "manual-package",
    checkerType: "exact",
    checkerLanguage: "python",
    checkerSourceCode: CHECKER_SOURCE_TEMPLATES.python,
    compareMode: "exact",
    zipSizeBytes: 0,
    fileCount: 0,
    isPartial: false,
    samples: [
      {
        id: createId("sample"),
        name: "sample1",
        description: "",
        input: "",
        output: "",
      },
    ],
    warnings: [],
    groups: [
      {
        id: createId("group"),
        name: "group1",
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
      },
    ],
  };
}

function parseDifficultyInput(
  raw: string,
): { ok: true; value: number | null } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: null };
  }
  if (!/^-?\d+$/.test(trimmed)) {
    return { ok: false, message: "Difficulty must be an integer." };
  }
  return { ok: true, value: Number.parseInt(trimmed, 10) };
}

export function ProblemEditorForm(props: ProblemEditorFormProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(
    props.mode === "edit" ? stateFromProblem(props.initialProblem) : emptyState(),
  );
  const [activeTab, setActiveTab] = useState<EditorTab>("content");
  const [isSaving, setIsSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState<ActionProgressState | null>(null);
  const [isInspectingPackage, setIsInspectingPackage] = useState(false);
  const [inspectProgressText, setInspectProgressText] = useState("");
  const [isExportingPackage, setIsExportingPackage] = useState(false);
  const [isLoadingExistingPackage, setIsLoadingExistingPackage] = useState(false);
  const [loadingTestCaseId, setLoadingTestCaseId] = useState<string | null>(null);
  const [isRunningPreview, setIsRunningPreview] = useState(false);
  const [error, setError] = useState<string>("");
  const [packageError, setPackageError] = useState<string>("");
  const [packageNotice, setPackageNotice] = useState<string>("");
  const [previewError, setPreviewError] = useState("");
  const [previewNotice, setPreviewNotice] = useState("");
  const [packageDraft, setPackageDraft] = useState<ProblemPackageEditorDraft | null>(
    props.initialPackageDraft ?? null,
  );
  const [previewLanguage, setPreviewLanguage] = useState<Language>("python");
  const [previewDraftsByLanguage, setPreviewDraftsByLanguage] = useState<Record<Language, string>>(
    SOURCE_CODE_TEMPLATES,
  );
  const [previewResult, setPreviewResult] = useState<PackageTestPreviewResult | null>(null);
  const [createdProblemId, setCreatedProblemId] = useState<string | null>(null);
  const importedPackageFileRef = useRef<File | null>(null);
  const importedPackageSignatureRef = useRef<string | null>(null);
  const generatedPackageFileCacheRef = useRef<{
    signature: string;
    file: File;
  } | null>(null);

  const endpoint = useMemo(() => {
    if (props.mode === "edit") {
      return `/api/problems/${props.initialProblem.id}`;
    }
    return "/api/problems";
  }, [props]);

  const method = props.mode === "edit" ? "PATCH" : "POST";
  const hasExistingStoredPackage =
    props.mode === "edit" && Boolean(props.initialProblem.latestPackageSummary);

  useEffect(() => {
    if (
      props.mode !== "edit" ||
      !hasExistingStoredPackage ||
      packageDraft ||
      isLoadingExistingPackage ||
      isInspectingPackage
    ) {
      return;
    }
    void loadExistingPackage();
  }, [
    hasExistingStoredPackage,
    isInspectingPackage,
    isLoadingExistingPackage,
    loadExistingPackage,
    packageDraft,
    props.mode,
  ]);

  async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
    try {
      const body = (await response.json()) as { error?: string };
      if (typeof body.error === "string" && body.error.trim().length > 0) {
        return body.error;
      }
    } catch {
      // no-op
    }
    return fallback;
  }

  async function inspectPackage(file: File) {
    setIsInspectingPackage(true);
    setPackageError("");
    setPackageNotice("");
    setInspectProgressText("Preparing ZIP import...");

    try {
      const inspected = await inspectProblemPackageClient(file, (progress) => {
        setInspectProgressText(`${progress.message} (${progress.current}/${progress.total})`);
      });
      setForm((prev) => ({
        ...prev,
        title: inspected.prefill.title || prev.title,
        slug: inspected.prefill.slugSuggestion || prev.slug,
        statementMarkdown: inspected.prefill.statementMarkdown,
        inputDescription: inspected.prefill.inputDescription,
        outputDescription: inspected.prefill.outputDescription,
        constraintsMarkdown: inspected.prefill.constraintsMarkdown,
        explanationMarkdown: inspected.prefill.explanationMarkdown,
        timeLimitMs: inspected.prefill.timeLimitMs,
        memoryLimitMb: inspected.prefill.memoryLimitMb,
        visibility: inspected.prefill.visibility ?? prev.visibility,
        explanationVisibility:
          inspected.prefill.explanationVisibility ?? prev.explanationVisibility,
        difficulty:
          inspected.prefill.difficulty === undefined
            ? prev.difficulty
            : inspected.prefill.difficulty === null
              ? ""
              : String(inspected.prefill.difficulty),
        testCaseVisibility:
          inspected.prefill.testCaseVisibility ?? prev.testCaseVisibility,
      }));
      setPackageDraft(inspected.draft);
      importedPackageFileRef.current = file;
      importedPackageSignatureRef.current = JSON.stringify({
        form: {
          ...form,
          title: inspected.prefill.title || form.title,
          slug: inspected.prefill.slugSuggestion || form.slug,
          statementMarkdown: inspected.prefill.statementMarkdown,
          inputDescription: inspected.prefill.inputDescription,
          outputDescription: inspected.prefill.outputDescription,
          constraintsMarkdown: inspected.prefill.constraintsMarkdown,
          explanationMarkdown: inspected.prefill.explanationMarkdown,
          timeLimitMs: inspected.prefill.timeLimitMs,
          memoryLimitMb: inspected.prefill.memoryLimitMb,
          visibility: inspected.prefill.visibility ?? form.visibility,
          explanationVisibility:
            inspected.prefill.explanationVisibility ?? form.explanationVisibility,
          difficulty:
            inspected.prefill.difficulty === undefined
              ? form.difficulty
              : inspected.prefill.difficulty === null
                ? ""
                : String(inspected.prefill.difficulty),
          testCaseVisibility:
            inspected.prefill.testCaseVisibility ?? form.testCaseVisibility,
        },
        draft: inspected.draft,
      });
      generatedPackageFileCacheRef.current = null;
      setPackageNotice(`Imported ${inspected.package.fileName} and filled the form fields.`);
    } catch (inspectError) {
      setPackageError(
        inspectError instanceof Error ? inspectError.message : "failed to inspect ZIP package",
      );
    } finally {
      setInspectProgressText("");
      setIsInspectingPackage(false);
    }
  }

  function patchLoadedTestCase(
    draft: ProblemPackageEditorDraft,
    params: {
      groupId: string;
      caseId: string;
    },
    testCase: {
      input: string;
      output: string;
    },
  ): ProblemPackageEditorDraft {
    return {
      ...draft,
      groups: draft.groups.map((group) =>
        group.id !== params.groupId
          ? group
          : {
              ...group,
              tests: group.tests.map((entry) =>
                entry.id !== params.caseId
                  ? entry
                  : {
                      ...entry,
                      input: testCase.input,
                      output: testCase.output,
                      isLoaded: true,
                    },
              ),
            },
      ),
    };
  }

  const loadExistingPackage = useCallback(async () => {
    if (props.mode !== "edit") {
      return;
    }

    setIsLoadingExistingPackage(true);
    setPackageError("");
    setPackageNotice("");
    setInspectProgressText("Loading stored package manifest...");

    try {
      const response = await fetch(`/api/problems/${props.initialProblem.id}/package/manifest`, {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) {
        const message = await parseErrorMessage(response, "failed to load stored package");
        throw new Error(message);
      }

      const body = (await response.json()) as { draft: ProblemPackageEditorDraft };
      setPackageDraft(body.draft);
      importedPackageFileRef.current = null;
      importedPackageSignatureRef.current = null;
      generatedPackageFileCacheRef.current = null;
      setPackageNotice(
        "Loaded package metadata. Individual test cases will be fetched only when selected.",
      );
    } catch (loadError) {
      setPackageError(
        loadError instanceof Error ? loadError.message : "failed to load stored package",
      );
    } finally {
      setInspectProgressText("");
      setIsLoadingExistingPackage(false);
    }
  }, [props]);

  async function loadExistingTestCase(params: {
    groupId: string;
    groupName: string;
    caseId: string;
    caseName: string;
  }) {
    if (props.mode !== "edit") {
      return;
    }

    const currentDraft = packageDraft;
    const currentCase = currentDraft?.groups
      .find((group) => group.id === params.groupId)
      ?.tests.find((testCase) => testCase.id === params.caseId);
    if (!currentDraft || currentCase?.isLoaded !== false || loadingTestCaseId === params.caseId) {
      return;
    }

    setLoadingTestCaseId(params.caseId);
    try {
      const url = new URL(
        `/api/problems/${props.initialProblem.id}/package/testcase`,
        window.location.origin,
      );
      url.searchParams.set("groupName", params.groupName);
      url.searchParams.set("caseName", params.caseName);
      const response = await fetch(url.toString(), {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) {
        const message = await parseErrorMessage(response, "failed to load test case");
        throw new Error(message);
      }

      const body = (await response.json()) as {
        testCase: {
          input: string;
          output: string;
        };
      };
      setPackageDraft((current) =>
        current ? patchLoadedTestCase(current, params, body.testCase) : current,
      );
    } catch (loadError) {
      setPackageError(loadError instanceof Error ? loadError.message : "failed to load test case");
    } finally {
      setLoadingTestCaseId((current) => (current === params.caseId ? null : current));
    }
  }

  async function hydratePartialPackageDraftIfNeeded(): Promise<ProblemPackageEditorDraft> {
    if (!packageDraft) {
      throw new Error("Judge package is required.");
    }
    if (!packageDraft.isPartial || props.mode !== "edit") {
      return packageDraft;
    }

    let nextDraft = packageDraft;
    const missingCases = nextDraft.groups.flatMap((group) =>
      group.tests
        .filter((testCase) => testCase.isLoaded === false)
        .map((testCase) => ({
          groupId: group.id,
          groupName: group.name,
          caseId: testCase.id,
          caseName: testCase.name,
        })),
    );
    if (missingCases.length === 0) {
      const completedDraft = {
        ...nextDraft,
        isPartial: false,
      };
      setPackageDraft(completedDraft);
      return completedDraft;
    }

    setIsLoadingExistingPackage(true);
    setPackageError("");
    try {
      for (const [index, missingCase] of missingCases.entries()) {
        setInspectProgressText(
          `Loading ${missingCase.groupName}/${missingCase.caseName} (${index + 1}/${missingCases.length})`,
        );
        const url = new URL(
          `/api/problems/${props.initialProblem.id}/package/testcase`,
          window.location.origin,
        );
        url.searchParams.set("groupName", missingCase.groupName);
        url.searchParams.set("caseName", missingCase.caseName);
        const response = await fetch(url.toString(), {
          method: "GET",
          cache: "no-store",
        });
        if (!response.ok) {
          const message = await parseErrorMessage(response, "failed to load test case");
          throw new Error(message);
        }
        const body = (await response.json()) as {
          testCase: {
            input: string;
            output: string;
          };
        };
        nextDraft = patchLoadedTestCase(nextDraft, missingCase, body.testCase);
        setPackageDraft(nextDraft);
      }

      nextDraft = {
        ...nextDraft,
        isPartial: false,
      };
      setPackageDraft(nextDraft);
      return nextDraft;
    } finally {
      setInspectProgressText("");
      setIsLoadingExistingPackage(false);
    }
  }

  async function uploadFileWithProgress<T>(input: {
    url: string;
    file: File;
    onProgress?: (ratio: number) => void;
  }): Promise<T> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", input.url);
      xhr.setRequestHeader("Content-Type", "application/zip");
      xhr.setRequestHeader("x-ojp-file-name", input.file.name);
      xhr.setRequestHeader("x-ojp-file-size", String(input.file.size));
      xhr.responseType = "text";

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable || !input.onProgress) {
          return;
        }
        input.onProgress(Math.max(0, Math.min(1, event.loaded / event.total)));
      };

      xhr.onerror = () => {
        reject(new Error("upload failed"));
      };
      xhr.onload = () => {
        let body: unknown = null;
        try {
          body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
        } catch {
          body = null;
        }

        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(body as T);
          return;
        }

        reject(
          new Error(
            typeof body === "object" &&
              body !== null &&
              "error" in body &&
              typeof (body as { error?: unknown }).error === "string"
              ? ((body as { error: string }).error)
              : "upload failed",
          ),
        );
      };

      xhr.send(input.file);
    });
  }

  async function uploadPackageToR2(
    file: File,
    onProgress?: (ratio: number) => void,
  ): Promise<{
    storageRef: UploadedPackageRef;
    fileName: string;
  }> {
    return uploadFileWithProgress<{
      storageRef: UploadedPackageRef;
      fileName: string;
    }>({
      url: "/api/problem-packages/upload",
      file,
      onProgress,
    });
  }

  async function pollPackageJob<T>(
    jobId: string,
    onProgress?: (status: "queued" | "running" | "completed" | "failed") => void,
  ): Promise<T> {
    for (;;) {
      const response = await fetch(`/api/package-jobs/${jobId}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const message = await parseErrorMessage(response, "failed to fetch package job");
        throw new Error(message);
      }

      const body = (await response.json()) as PackageJobEnvelope;
      onProgress?.(body.job.status);
      if (body.job.status === "completed") {
        return body.job.result as T;
      }
      if (body.job.status === "failed") {
        throw new Error(body.job.error || "package job failed");
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  async function buildCurrentPackageFile(): Promise<File> {
    const resolvedDraft = await hydratePartialPackageDraftIfNeeded();

    const signature = JSON.stringify({
      form,
      draft: resolvedDraft,
    });
    if (
      importedPackageFileRef.current &&
      importedPackageSignatureRef.current === signature
    ) {
      return importedPackageFileRef.current;
    }
    if (generatedPackageFileCacheRef.current?.signature === signature) {
      return generatedPackageFileCacheRef.current.file;
    }

    const zipBlob = await buildProblemPackageZipBlob({
      title: form.title,
      slug: form.slug,
      statementMarkdown: form.statementMarkdown,
      inputDescription: form.inputDescription,
      outputDescription: form.outputDescription,
      constraintsMarkdown: form.constraintsMarkdown,
      explanationMarkdown: form.explanationMarkdown,
      visibility: form.visibility,
      explanationVisibility: form.explanationVisibility,
      difficulty:
        form.difficulty.trim().length > 0 ? Number.parseInt(form.difficulty, 10) : null,
      testCaseVisibility: form.testCaseVisibility,
      timeLimitMs: form.timeLimitMs,
      memoryLimitMb: form.memoryLimitMb,
      draft: resolvedDraft,
    });
    const file = new File(
      [zipBlob],
      `${form.slug.trim() || resolvedDraft.sourceLabel || "problem-package"}.zip`,
      { type: "application/zip" },
    );
    generatedPackageFileCacheRef.current = {
      signature,
      file,
    };
    return file;
  }

  async function saveProblemPackage(problemId: string) {
    if (!packageDraft) {
      return;
    }

    setSaveProgress({
      phase: "Building package ZIP...",
      percent: 20,
    });
    const packageFile = await buildCurrentPackageFile();

    const body = await uploadFileWithProgress<
      | PackageJobEnvelope
      | {
          package?: unknown;
          problem?: Problem;
        }
    >({
      url: `/api/problems/${problemId}/package`,
      file: packageFile,
      onProgress: (ratio) => {
        setSaveProgress({
          phase: "Uploading package ZIP...",
          percent: 20 + Math.round(ratio * 40),
        });
      },
    });
    if ("job" in body && body.job) {
      setPackageNotice("Package uploaded. Waiting for worker validation...");
      setSaveProgress({
        phase: "Package uploaded. Waiting for worker...",
        percent: 65,
      });
      await pollPackageJob<{ problemId: string }>(body.job.id, (status) => {
        setPackageNotice(
          status === "running"
            ? "Worker is validating and applying the package..."
            : "Package job is queued...",
        );
        setSaveProgress({
          phase:
            status === "running"
              ? "Worker is validating and applying the package..."
              : "Package job is queued...",
          percent: status === "running" ? 85 : 75,
        });
      });
      setPackageNotice("Package validation completed.");
      setSaveProgress({
        phase: "Package validation completed.",
        percent: 95,
      });
    } else {
      setSaveProgress({
        phase: "Package validation completed.",
        percent: 95,
      });
    }
  }

  async function runPackagePreview() {
    if (!packageDraft) {
      setPreviewError("Judge package is required before running a local test.");
      return;
    }

    const sourceCode = previewDraftsByLanguage[previewLanguage] ?? "";
    if (!sourceCode.trim()) {
      setPreviewError("Source code is required.");
      return;
    }

    setIsRunningPreview(true);
    setPreviewError("");
    setPreviewNotice("");
    setPreviewResult(null);

    try {
      const packageFile = await buildCurrentPackageFile();

      try {
        setPreviewNotice("Uploading package ZIP to object storage...");
        const upload = await uploadPackageToR2(packageFile, (ratio) => {
          setPreviewNotice(`Uploading package ZIP to object storage... (${Math.round(ratio * 100)}%)`);
        });
        const response = await fetch("/api/problem-packages/test", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            storageRef: upload.storageRef,
            fileName: upload.fileName,
            sourceCode,
            language: previewLanguage,
            timeLimitMs: form.timeLimitMs,
            memoryLimitMb: form.memoryLimitMb,
            problemId: props.mode === "edit" ? props.initialProblem.id : null,
          }),
        });
        if (!response.ok) {
          const message = await parseErrorMessage(response, "failed to run package test");
          throw new Error(message);
        }

        const body = (await response.json()) as PackageJobEnvelope;
        setPreviewNotice("Preview job queued. Waiting for worker...");
        const result = await pollPackageJob<PackageTestPreviewResult>(body.job.id, (status) => {
          setPreviewNotice(
            status === "running" ? "Worker is running the preview..." : "Preview job is queued...",
          );
        });
        setPreviewResult(result);
        setPreviewNotice("Preview completed.");
      } catch (asyncError) {
        const message = asyncError instanceof Error ? asyncError.message : "failed to run package test";
        if (message.includes("R2 is required")) {
          setPreviewNotice("R2 upload is unavailable. Falling back to direct server preview...");
          const formData = new FormData();
          formData.set("file", packageFile);
          formData.set("language", previewLanguage);
          formData.set("sourceCode", sourceCode);
          formData.set("timeLimitMs", String(form.timeLimitMs));
          formData.set("memoryLimitMb", String(form.memoryLimitMb));

          const response = await fetch("/api/problem-packages/test", {
            method: "POST",
            body: formData,
          });
          if (!response.ok) {
            const fallbackMessage = await parseErrorMessage(response, "failed to run package test");
            throw new Error(fallbackMessage);
          }

          const body = (await response.json()) as { result: PackageTestPreviewResult };
          setPreviewResult(body.result);
          setPreviewNotice("Preview completed.");
        } else {
          throw asyncError;
        }
      }
    } catch (previewRunError) {
      setPreviewError(
        previewRunError instanceof Error
          ? previewRunError.message
          : "failed to run package test",
      );
    } finally {
      setIsRunningPreview(false);
    }
  }

  async function downloadPackageZip() {
    if (!packageDraft) {
      setPackageError("Judge package is required before downloading ZIP.");
      return;
    }

    setIsExportingPackage(true);
    setPackageError("");

    try {
      const packageFile = await buildCurrentPackageFile();
      const url = URL.createObjectURL(packageFile);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = packageFile.name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setPackageError(
        exportError instanceof Error ? exportError.message : "failed to export problem package",
      );
    } finally {
      setIsExportingPackage(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.statementMarkdown.trim()) {
      setError("Statement is required.");
      return;
    }

    const parsedDifficulty = parseDifficultyInput(form.difficulty);
    if (!parsedDifficulty.ok) {
      setError(parsedDifficulty.message);
      return;
    }

    setIsSaving(true);
    setError("");
    setCreatedProblemId(null);
    setSaveProgress({
      phase: "Saving problem metadata...",
      percent: 10,
    });

    try {
      const response = await fetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...form,
          difficulty: parsedDifficulty.value,
        }),
      });

      if (!response.ok) {
        const message = await parseErrorMessage(response, "failed to save problem");
        throw new Error(message);
      }

      const body = (await response.json()) as { problem: Problem };
      if (props.mode === "create") {
        setCreatedProblemId(body.problem.id);
      }
      setSaveProgress({
        phase: packageDraft ? "Problem metadata saved. Preparing package..." : "Problem metadata saved.",
        percent: packageDraft ? 15 : 85,
      });
      await saveProblemPackage(body.problem.id);

      setSaveProgress({
        phase: "Redirecting to problem page...",
        percent: 100,
      });
      router.push(`/problems/${body.problem.id}`);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unexpected error occurred.");
      setSaveProgress(null);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <section className="panel stack">
        <div className="button-row">
          <button
            type="button"
            className={activeTab === "content" ? "button" : "button button-secondary"}
            onClick={() => setActiveTab("content")}
          >
            問題文など
          </button>
          <button
            type="button"
            className={activeTab === "settings" ? "button" : "button button-secondary"}
            onClick={() => setActiveTab("settings")}
          >
            問題の設定など
          </button>
          <button
            type="button"
            className={activeTab === "tests" ? "button" : "button button-secondary"}
            onClick={() => setActiveTab("tests")}
          >
            テストケース
          </button>
          <button
            type="button"
            className={activeTab === "testrun" ? "button" : "button button-secondary"}
            onClick={() => setActiveTab("testrun")}
          >
            テスト run
          </button>
        </div>
      </section>

      {activeTab === "content" ? (
        <section className="stack">
          <div className="form-grid">
            <label className="field">
              <span className="field-label">Title</span>
              <input
                className="input"
                required
                value={form.title}
                onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                placeholder="A - Sample Problem"
              />
            </label>
            <label className="field">
              <span className="field-label">Slug</span>
              <input
                className="input"
                required
                value={form.slug}
                onChange={(event) => setForm((prev) => ({ ...prev, slug: event.target.value }))}
                placeholder="a-sample-problem"
              />
            </label>
          </div>

          <div className="field">
            <span className="field-label">Statement (Markdown)</span>
            <CodeEditor
              language="markdown"
              minHeight={260}
              value={form.statementMarkdown}
              onChange={(value) => setForm((prev) => ({ ...prev, statementMarkdown: value }))}
            />
            <div className="markdown-preview">
              <span className="field-label">Live Preview</span>
              <div className="panel stack">
                <MarkdownBlock text={form.statementMarkdown || "_No preview yet._"} />
              </div>
            </div>
          </div>

          <div className="form-grid">
            <label className="field">
              <span className="field-label">Input Description</span>
              <textarea
                className="textarea"
                required
                value={form.inputDescription}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, inputDescription: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span className="field-label">Output Description</span>
              <textarea
                className="textarea"
                required
                value={form.outputDescription}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, outputDescription: event.target.value }))
                }
              />
            </label>
          </div>

          <div className="form-grid">
            <label className="field">
              <span className="field-label">Constraints</span>
              <textarea
                className="textarea"
                required
                value={form.constraintsMarkdown}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, constraintsMarkdown: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span className="field-label">Explanation</span>
              <textarea
                className="textarea"
                value={form.explanationMarkdown}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, explanationMarkdown: event.target.value }))
                }
              />
            </label>
          </div>
        </section>
      ) : null}

      {activeTab === "settings" ? (
        <section className="stack">
          <div className="form-grid">
            <label className="field">
              <span className="field-label">Visibility</span>
              <select
                className="select"
                value={form.visibility}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, visibility: event.target.value as Visibility }))
                }
              >
                <option value="public">Public</option>
                <option value="unlisted">Unlisted</option>
                <option value="private">Private</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">Explanation Visibility</span>
              <select
                className="select"
                value={form.explanationVisibility}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    explanationVisibility: event.target.value as ExplanationVisibility,
                  }))
                }
              >
                <option value="always">always</option>
                <option value="contest_end">contest_end</option>
                <option value="private">private (default)</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">Difficulty (AtCoder rating)</span>
              <input
                className="input"
                type="number"
                step={1}
                value={form.difficulty}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, difficulty: event.target.value }))
                }
                placeholder="800"
              />
              <p className="text-soft">Optional integer value (for example: 400, 800, 1200).</p>
            </label>
            <label className="field">
              <span className="field-label">Time Limit (ms)</span>
              <input
                className="input"
                type="number"
                min={1}
                value={form.timeLimitMs}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, timeLimitMs: Number(event.target.value) }))
                }
              />
            </label>
            <label className="field">
              <span className="field-label">Memory Limit (MB)</span>
              <input
                className="input"
                type="number"
                min={1}
                value={form.memoryLimitMb}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, memoryLimitMb: Number(event.target.value) }))
                }
              />
            </label>
            <label className="field">
              <span className="field-label">Test Case Visibility</span>
              <select
                className="select"
                value={form.testCaseVisibility}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    testCaseVisibility: event.target.value as TestCaseVisibility,
                  }))
                }
              >
                <option value="group_only">group_only</option>
                <option value="case_index_only">case_index_only (default)</option>
                <option value="case_name_visible">case_name_visible</option>
              </select>
              <p className="text-soft">
                Use `case_name_visible` only when needed to avoid leaking hidden test intent.
              </p>
            </label>
          </div>
        </section>
      ) : null}

      {activeTab === "tests" ? (
        <section className="panel stack">
          <div>
            <h2 className="panel-title">Judge Package</h2>
            <p className="panel-subtitle">
              ZIP import / export と、サンプル・グループ・ケース・checker 設定をここで管理します。
            </p>
          </div>

          <label className="field">
            <span className="field-label">Import ZIP</span>
            <input
              className="input"
              type="file"
              accept=".zip,application/zip"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                if (file) {
                  void inspectPackage(file);
                }
              }}
            />
            <p className="text-soft">
              Selecting a ZIP inspects `statement.md` and `config.json`, fills the problem fields,
              and converts its tests into the editor below.
            </p>
          </label>

          <div className="button-row">
            {!packageDraft ? (
              <>
                {hasExistingStoredPackage ? (
                  <>
                    <button
                      type="button"
                      className="button"
                      onClick={() => void loadExistingPackage()}
                      disabled={isLoadingExistingPackage || isInspectingPackage}
                    >
                      {isLoadingExistingPackage ? "Loading Package Metadata..." : "Load Existing Package"}
                    </button>
                    <a
                      className="button button-secondary"
                      href={`/api/problems/${props.initialProblem.id}/package`}
                    >
                      Download Stored ZIP
                    </a>
                  </>
                ) : null}
                <button
                  type="button"
                  className={hasExistingStoredPackage ? "button button-secondary" : "button"}
                  onClick={() => {
                    setPackageDraft(createBlankPackageDraft());
                    setPackageNotice("Started a blank manual package.");
                    setPackageError("");
                  }}
                >
                  Start Manual Package
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => {
                    setPackageDraft(createBlankPackageDraft());
                    setPackageNotice("Reset the package editor to a blank template.");
                    setPackageError("");
                  }}
                >
                  Reset to Blank
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => {
                    setPackageDraft(null);
                    setPackageNotice(
                      props.mode === "edit"
                        ? "Package editor disabled. Existing package stays unchanged on save."
                        : "Package editor cleared. This problem will be created without a package.",
                    );
                    setPackageError("");
                  }}
                >
                  Clear Package
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => void downloadPackageZip()}
                  disabled={isExportingPackage}
                >
                  {isExportingPackage ? "Exporting..." : "Download ZIP"}
                </button>
                {packageDraft.isPartial ? (
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => void hydratePartialPackageDraftIfNeeded()}
                    disabled={isLoadingExistingPackage}
                  >
                    {isLoadingExistingPackage ? "Loading All Cases..." : "Load All Cases"}
                  </button>
                ) : null}
              </>
            )}
          </div>

          {isInspectingPackage ? (
            <p className="badge badge-blue">
              {inspectProgressText || "Inspecting ZIP..."}
            </p>
          ) : null}
          {packageNotice ? <p className="badge badge-blue">{packageNotice}</p> : null}
          {packageError ? <p className="badge badge-red">{packageError}</p> : null}

          {packageDraft ? (
            <ProblemPackageDraftEditor
              draft={packageDraft}
              onChange={setPackageDraft}
              onLoadTestCase={props.mode === "edit" ? loadExistingTestCase : undefined}
              loadingTestCaseId={loadingTestCaseId}
            />
          ) : (
            <div className="stack">
              <p className="empty">
                {hasExistingStoredPackage
                  ? "This problem already has a stored package. Load it only when you need to inspect or edit tests."
                  : "No package is attached yet. Start from a blank manual package or import a ZIP."}
              </p>
              {hasExistingStoredPackage ? (
                <p className="text-soft">
                  Stored ZIP: {props.initialProblem.latestPackageSummary?.fileName} (
                  {Math.ceil((props.initialProblem.latestPackageSummary?.zipSizeBytes ?? 0) / 1024 / 1024)} MB)
                </p>
              ) : null}
            </div>
          )}
        </section>
      ) : null}

      {activeTab === "testrun" ? (
        <section className="panel stack">
          <div>
            <h2 className="panel-title">Package Test Run</h2>
            <p className="panel-subtitle">
              現在のテストケースと special judge 設定を使って、保存前にコードを試せます。
            </p>
          </div>

          <label className="field">
            <span className="field-label">Language</span>
            <select
              className="select"
              value={previewLanguage}
              onChange={(event) => setPreviewLanguage(event.target.value as Language)}
            >
              <option value="cpp">cpp</option>
              <option value="python">python</option>
              <option value="java">java</option>
              <option value="javascript">javascript</option>
            </select>
          </label>

          <div className="field">
            <span className="field-label">Source Code</span>
            <CodeEditor
              language={previewLanguage}
              minHeight={300}
              value={previewDraftsByLanguage[previewLanguage] ?? ""}
              onChange={(value) =>
                setPreviewDraftsByLanguage((current) => ({
                  ...current,
                  [previewLanguage]: value,
                }))
              }
            />
          </div>

          <div className="button-row">
            {!packageDraft && hasExistingStoredPackage ? (
              <button
                type="button"
                className="button button-secondary"
                onClick={() => void loadExistingPackage()}
                disabled={isLoadingExistingPackage || isInspectingPackage}
              >
                {isLoadingExistingPackage ? "Loading Package Metadata..." : "Load Existing Package First"}
              </button>
            ) : null}
            <button
              type="button"
              className="button"
              onClick={() => void runPackagePreview()}
              disabled={isRunningPreview || !packageDraft}
            >
              {isRunningPreview ? "Running..." : "Run Test"}
            </button>
          </div>

          {previewError ? <p className="badge badge-red">{previewError}</p> : null}
          {previewNotice ? <p className="badge badge-blue">{previewNotice}</p> : null}

          {previewResult ? (
            <div className="stack">
              <div className="meta-inline">
                <StatusBadge className={badgeClassForSubmission(previewResult.status)}>
                  {submissionStatusLabel(previewResult.status)}
                </StatusBadge>
                <span className="text-soft">Score: {previewResult.score}</span>
                <span className="text-soft">Time: {previewResult.totalTimeMs} ms</span>
                <span className="text-soft">Memory: {previewResult.peakMemoryKb} KB</span>
              </div>
              <div className="stack">
                {groupPreviewResults(previewResult.testResults).map((group) => (
                  <details key={group.groupName} className="result-group">
                    <summary className="result-group-summary">
                      <span className="kpi">{group.groupName}</span>
                      <StatusBadge className={badgeClassForSubmission(group.verdict)}>
                        {submissionStatusLabel(group.verdict)}
                      </StatusBadge>
                      <span className="result-group-meta">Cases: {group.caseCount}</span>
                      <span className="result-group-meta">Time(max): {group.maxTimeMs} ms</span>
                      <span className="result-group-meta">Memory: {group.peakMemoryKb} KB</span>
                    </summary>
                    <div className="result-group-body">
                      <div className="table-wrap">
                        <table className="table">
                          <thead>
                            <tr>
                              <th>Case</th>
                              <th>Verdict</th>
                              <th>Time</th>
                              <th>Memory</th>
                              <th>Message</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.cases.map((result) => (
                              <tr key={result.id}>
                                <td>{result.testCaseName}</td>
                                <td>
                                  <StatusBadge className={badgeClassForSubmission(result.verdict)}>
                                    {submissionStatusLabel(result.verdict)}
                                  </StatusBadge>
                                </td>
                                <td>{result.timeMs} ms</td>
                                <td>{result.memoryKb} KB</td>
                                <td>{result.message}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </details>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {saveProgress ? (
        <div className="panel stack">
          <p className="badge badge-blue">
            {saveProgress.phase} ({saveProgress.percent}%)
          </p>
          <progress max={100} value={saveProgress.percent} />
        </div>
      ) : null}
      {error ? <p className="badge badge-red">{error}</p> : null}
      {props.mode === "create" && createdProblemId ? (
        <div className="button-row">
          <Link className="button button-secondary" href={`/problems/${createdProblemId}/edit`}>
            Open Created Problem
          </Link>
        </div>
      ) : null}

      <div className="button-row">
        <button className="button" type="submit" disabled={isSaving || isInspectingPackage}>
          {isSaving ? "Saving..." : props.mode === "edit" ? "Update" : "Create"}
        </button>
      </div>
    </form>
  );
}
