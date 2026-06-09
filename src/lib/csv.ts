import Papa from "papaparse";

// ===========================================================================
// CSV import format (header row required, case-insensitive):
//
//   question, timeLimit, points, option1, option2, option3, option4, correct
//
// - question  (required) the prompt text
// - timeLimit (optional, seconds, default 20)
// - points    (optional, default 1000)
// - option1..option6 : 2 to 6 answer choices; blank columns are ignored
// - correct   (required) which option is correct, as a 1-based number (e.g. 2)
//              OR a letter (A,B,C,...). Currently single-correct only.
//
// Example row:
//   "What is 2+2?",20,1000,3,4,5,6,2
// ===========================================================================

export interface ParsedOption {
  text: string;
  isCorrect: boolean;
}

export interface ParsedQuestion {
  text: string;
  timeLimit: number;
  points: number;
  options: ParsedOption[];
}

export interface CsvParseResult {
  questions: ParsedQuestion[];
  errors: string[];
}

const MAX_OPTIONS = 6;

function letterToIndex(value: string): number | null {
  const v = value.trim();
  if (/^\d+$/.test(v)) return parseInt(v, 10) - 1; // 1-based number -> 0-based
  if (/^[A-Za-z]$/.test(v)) return v.toUpperCase().charCodeAt(0) - 65; // A->0
  return null;
}

export function parseQuizCsv(content: string): CsvParseResult {
  const errors: string[] = [];
  const questions: ParsedQuestion[] = [];

  const result = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  if (result.errors.length) {
    for (const e of result.errors) {
      errors.push(`CSV parse error (row ${e.row ?? "?"}): ${e.message}`);
    }
  }

  result.data.forEach((row, i) => {
    const lineNo = i + 2; // +1 for header, +1 for 1-based display
    const text = (row["question"] ?? "").trim();
    if (!text) {
      // silently skip completely blank rows; flag rows that have data but no question
      const hasAny = Object.values(row).some((v) => (v ?? "").trim() !== "");
      if (hasAny) errors.push(`Line ${lineNo}: missing "question"`);
      return;
    }

    const options: ParsedOption[] = [];
    for (let n = 1; n <= MAX_OPTIONS; n++) {
      const raw = (row[`option${n}`] ?? "").trim();
      if (raw) options.push({ text: raw, isCorrect: false });
    }

    if (options.length < 2) {
      errors.push(`Line ${lineNo}: "${text}" needs at least 2 options`);
      return;
    }

    const correctIdx = letterToIndex(row["correct"] ?? "");
    if (correctIdx === null || correctIdx < 0 || correctIdx >= options.length) {
      errors.push(
        `Line ${lineNo}: "${text}" has an invalid "correct" value (got "${row["correct"] ?? ""}")`
      );
      return;
    }
    options[correctIdx].isCorrect = true;

    const timeLimit = clampInt(row["timelimit"], 5, 300, 20);
    const points = clampInt(row["points"], 0, 100000, 1000);

    questions.push({ text, timeLimit, points, options });
  });

  return { questions, errors };
}

function clampInt(
  raw: string | undefined,
  min: number,
  max: number,
  fallback: number
): number {
  const v = parseInt((raw ?? "").trim(), 10);
  if (Number.isNaN(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}
