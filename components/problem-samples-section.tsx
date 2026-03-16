"use client";

import { useEffect, useState } from "react";
import { ProblemSampleCase } from "@/lib/types";

interface ProblemSamplesSectionProps {
  initialSamples: ProblemSampleCase[];
  loadUrl?: string;
  samplePairCount: number;
}

export function ProblemSamplesSection({
  initialSamples,
  loadUrl,
  samplePairCount,
}: ProblemSamplesSectionProps) {
  const shouldAutoLoad = initialSamples.length === 0 && Boolean(loadUrl) && samplePairCount > 0;
  const [samples, setSamples] = useState<ProblemSampleCase[]>(initialSamples);
  const [isLoading, setIsLoading] = useState(shouldAutoLoad);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!shouldAutoLoad || !loadUrl) {
      return;
    }

    let cancelled = false;
    void fetch(loadUrl, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error || "failed to load problem samples");
        }
        return response.json() as Promise<{ samples: ProblemSampleCase[] }>;
      })
      .then((body) => {
        if (!cancelled) {
          setSamples(body.samples);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : "failed to load problem samples",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [loadUrl, shouldAutoLoad]);

  if (samples.length === 0 && samplePairCount <= 0 && !isLoading) {
    return null;
  }

  return (
    <section className="panel stack">
      <h2 className="panel-title">Samples</h2>
      {isLoading && samples.length === 0 ? (
        <p className="badge badge-blue">Loading samples...</p>
      ) : null}
      {error ? <p className="badge badge-red">{error}</p> : null}
      {samples.map((sample) => (
        <article key={sample.name} className="package-case-editor stack">
          <p className="field-label">{sample.name}</p>
          <div className="form-grid">
            <div className="field">
              <span className="field-label">Input</span>
              <pre className="code-block">{sample.input}</pre>
            </div>
            <div className="field">
              <span className="field-label">Output</span>
              <pre className="code-block">{sample.output}</pre>
            </div>
          </div>
          {sample.description ? (
            <p className="sample-description text-soft">{sample.description}</p>
          ) : null}
        </article>
      ))}
    </section>
  );
}
