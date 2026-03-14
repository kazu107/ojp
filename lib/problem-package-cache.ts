import { createHash } from "node:crypto";
import {
  ProblemPackageExtracted,
  validateProblemPackage,
} from "@/lib/problem-package";

const CACHE_LIMIT = 32;

const globalCache = globalThis as unknown as {
  __ojpProblemPackageValidationCache?: Map<string, ProblemPackageExtracted>;
};

function getCache(): Map<string, ProblemPackageExtracted> {
  if (!globalCache.__ojpProblemPackageValidationCache) {
    globalCache.__ojpProblemPackageValidationCache = new Map();
  }
  return globalCache.__ojpProblemPackageValidationCache;
}

function cacheKey(fileName: string, zipBuffer: Buffer): string {
  return `${fileName}:${createHash("sha256").update(zipBuffer).digest("hex")}`;
}

export function validateProblemPackageCached(
  fileName: string,
  zipBuffer: Buffer,
): ProblemPackageExtracted {
  const key = cacheKey(fileName, zipBuffer);
  const cache = getCache();
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const extracted = validateProblemPackage(fileName, zipBuffer);
  cache.set(key, extracted);
  if (cache.size > CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) {
      cache.delete(oldestKey);
    }
  }
  return extracted;
}
