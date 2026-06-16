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
// - correct   (required) which option(s) are correct, as 1-based numbers
//              (e.g. 2) OR letters (A,B,C,...). For multi-answer questions list
//              several, separated by space / semicolon / pipe / slash — or by a
//              comma IF the whole field is wrapped in double quotes. A question
//              with more than one correct value becomes a "choose all" question.
//
// Example rows:
//   "What is 2+2?",20,1000,3,4,5,6,2            <- single answer (option 2)
//   "Pick the primes",20,1000,4,6,7,9,"1 3"     <- multi answer (options 1 & 3)
//   "Pick the even ones",20,1000,1,2,3,4,B;D    <- multi answer (options 2 & 4)
//
// NOTE: any field that contains a comma MUST be wrapped in double quotes,
// otherwise the extra comma shifts the columns. This is standard CSV (RFC 4180)
// and spreadsheet exports do it automatically. Example:
//   "Which costs more, A or B?",20,1000,"A, the first","B, the second",2
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

// Parse the "correct" column into a list of 0-based option indexes. Accepts a
// single value ("2", "B") or several separated by space/comma/semicolon/pipe/
// slash ("1 3", "A,C", "B;D"). Returns null if any token is unparseable.
function parseCorrectIndexes(value: string): number[] | null {
  const tokens = value
    .split(/[\s,;|/]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;
  const idxs: number[] = [];
  for (const t of tokens) {
    const idx = letterToIndex(t);
    if (idx === null) return null;
    if (!idxs.includes(idx)) idxs.push(idx);
  }
  return idxs;
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

    // PapaParse stows columns beyond the header under "__parsed_extra". When a
    // question or option contains an unquoted comma, the row gains a column and
    // everything shifts — give a clear, actionable error instead of a cryptic
    // downstream failure. (The fix is to wrap such fields in double quotes.)
    if (row["__parsed_extra"] != null) {
      errors.push(
        `Line ${lineNo}: too many columns — if a question or option contains a comma, ` +
          `wrap that field in double quotes, e.g. "What is 2+2, exactly?"`
      );
      return;
    }

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

    const correctIdxs = parseCorrectIndexes(row["correct"] ?? "");
    if (correctIdxs === null || correctIdxs.some((i) => i < 0 || i >= options.length)) {
      errors.push(
        `Line ${lineNo}: "${text}" has an invalid "correct" value (got "${row["correct"] ?? ""}")`
      );
      return;
    }
    for (const i of correctIdxs) options[i].isCorrect = true;

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
