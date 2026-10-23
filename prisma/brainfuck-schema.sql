-- Add a language without recreating enum types or modifying existing rows.
ALTER TYPE "Language" ADD VALUE IF NOT EXISTS 'brainfuck';
