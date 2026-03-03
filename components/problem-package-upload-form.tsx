"use client";

import { FormEvent, useState } from "react";
import type { ProblemPackageValidationResult } from "@/lib/problem-package";

interface ProblemPackageUploadFormProps {
  problemId: string;
}

export function ProblemPackageUploadForm({ problemId }: ProblemPackageUploadFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ProblemPackageValidationResult | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError("ZIPファイルを選択してください。");
      return;
    }

    setIsUploading(true);
    setError("");
    setResult(null);

    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch(`/api/problems/${problemId}/package`, {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as {
        error?: string;
        package?: ProblemPackageValidationResult;
      };
      if (!response.ok || !payload.package) {
        throw new Error(payload.error ?? "ZIP検証に失敗しました。");
      }

      setResult(payload.package);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "アップロードに失敗しました。");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <label className="field">
        <span className="field-label">Problem Package (ZIP)</span>
        <input
          className="input"
          type="file"
          accept=".zip,application/zip"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </label>

      <p className="text-soft">
        Required files: `statement.md`, `config.json`, `samples/*.in/.out`,
        `tests/&lt;group&gt;/*.in/.out`
      </p>
      <p className="text-soft">
        Group partial scores are optional. If you set `groups[].score`, every group must have it
        and total score must be exactly 100. If omitted, the judge uses binary scoring (all groups
        passed = 100).
      </p>

      {error ? <p className="badge badge-red">{error}</p> : null}

      <div className="button-row">
        <button type="submit" className="button" disabled={isUploading}>
          {isUploading ? "Validating..." : "Validate ZIP Package"}
        </button>
      </div>

      {result ? (
        <div className="panel stack">
          <h3 className="panel-title">Validation Result</h3>
          <p className="text-soft">File: {result.fileName}</p>
          <p className="text-soft">
            ZIP size: {result.zipSizeBytes} bytes / Files: {result.fileCount}
          </p>
          <p className="text-soft">
            Samples: {result.samplePairs} pairs / Tests: {result.testGroupCount} groups,{" "}
            {result.totalTestPairs} pairs
          </p>
          <p className="text-soft">
            Config: TL {result.config.timeLimitMs} ms / ML {result.config.memoryLimitMb} MB /{" "}
            {result.config.scoringType} / {result.config.compareMode}
          </p>
          <p className="text-soft">Languages: {result.config.languages.join(", ")}</p>
          {result.warnings.length > 0 ? (
            <div className="stack">
              <p className="field-label">Warnings</p>
              {result.warnings.map((warning) => (
                <p key={warning} className="text-soft">
                  - {warning}
                </p>
              ))}
            </div>
          ) : (
            <p className="badge">No warnings.</p>
          )}
        </div>
      ) : null}
    </form>
  );
}
