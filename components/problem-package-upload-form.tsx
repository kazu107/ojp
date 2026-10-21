"use client";
import { useI18n } from "@/components/i18n-provider";


import { FormEvent, useState } from "react";
import type { ProblemPackageValidationResult } from "@/lib/problem-package";

interface ProblemPackageUploadFormProps {
  problemId: string;
}

export function ProblemPackageUploadForm({ problemId }: ProblemPackageUploadFormProps) {
  const { t } = useI18n();
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
        <span className="field-label">{t("Problem Package (ZIP)")}</span>
        <input
          className="input"
          type="file"
          accept=".zip,application/zip"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </label>

      <p className="text-soft">
        {t("Required files: `statement.md`, `config.json`, `samples/*.in/.out`, `tests/<group>/*.in/.out`")}</p>
      <p className="text-soft">
        {t("In ")}<code>config.json</code>{t(", each group can be either ")}<code>&quot;group1&quot;</code> {t(" or")}{" "}
        <code>{t("{ \"name\": \"group1\", \"score\": 50 }")}</code>{t(". Test files are auto-detected from each ")}<code>tests/&lt;group&gt;/</code> {t(" directory.")}</p>
      <p className="text-soft">
        {t("For special judge, set ")}<code>checkerType</code> {t(" to ")}<code>special_judge</code>{t(", set")}{" "}
        <code>checkerLanguage</code>{t(", and include the checker source at ")}<code>checker/Main.*</code>.
      </p>
      <p className="text-soft">
        {t("Group partial scores are optional. If you set `groups[].score`, every group must have it and total score must be exactly 100. If omitted, the judge uses binary scoring (all groups passed = 100).")}</p>

      {error ? <p className="badge badge-red">{t(error)}</p> : null}

      <div className="button-row">
        <button type="submit" className="button" disabled={isUploading}>
          {isUploading ? t("Validating...") : t("Validate ZIP Package")}
        </button>
      </div>

      {result ? (
        <div className="panel stack">
          <h3 className="panel-title">{t("Validation Result")}</h3>
          <p className="text-soft">{t("File: ")}{result.fileName}</p>
          <p className="text-soft">
            {t("ZIP size: ")}{result.zipSizeBytes} {t(" bytes / Files: ")}{result.fileCount}
          </p>
          <p className="text-soft">
            {t("Samples: ")}{result.samplePairs} {t(" pairs / Tests: ")}{result.testGroupCount} {t(" groups,")}{" "}
            {result.totalTestPairs} {t(" pairs")}</p>
          <p className="text-soft">
            {t("Config: TL ")}{result.config.timeLimitMs} {t(" ms / ML ")}{result.config.memoryLimitMb} {t(" MB /")}{" "}
            {t(result.config.scoringType)} / {t(result.config.checkerType)}
            {result.config.checkerLanguage ? `(${result.config.checkerLanguage})` : ""} /{" "}
            {t(result.config.compareMode)}
          </p>
          {result.warnings.length > 0 ? (
            <div className="stack">
              <p className="field-label">{t("Warnings")}</p>
              {result.warnings.map((warning) => (
                <p key={t(warning)} className="text-soft">
                  - {t(warning)}
                </p>
              ))}
            </div>
          ) : (
            <p className="badge">{t("No warnings.")}</p>
          )}
        </div>
      ) : null}
    </form>
  );
}
