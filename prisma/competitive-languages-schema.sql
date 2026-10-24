-- Additive values only; preserve existing problems, submissions, and enum labels.
ALTER TYPE "Language" ADD VALUE IF NOT EXISTS 'c';
ALTER TYPE "Language" ADD VALUE IF NOT EXISTS 'rust';
ALTER TYPE "Language" ADD VALUE IF NOT EXISTS 'go';
ALTER TYPE "Language" ADD VALUE IF NOT EXISTS 'csharp';
ALTER TYPE "Language" ADD VALUE IF NOT EXISTS 'kotlin';
ALTER TYPE "Language" ADD VALUE IF NOT EXISTS 'ruby';
ALTER TYPE "Language" ADD VALUE IF NOT EXISTS 'pypy';
