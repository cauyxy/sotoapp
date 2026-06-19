// Decides whether a term diffed out of an edit is a plausible new hotword.
// PROVISIONAL rules, pinned by the colocated tests.

// Provisional stop-word / common-word blacklist (CN function words + EN
// function words).
const COMMON_WORDS = new Set<string>([
  // 中文虚词 / 高频词
  "的", "了", "是", "在", "和", "也", "都", "就", "要", "我", "你", "他", "她", "它", "有", "这",
  "那", "上", "下", "里", "外", "中", "前", "后", "很", "不", "没", "来", "去", "说", "一", "个",
  // 英文虚词 / 高频词
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "and", "or", "but", "to", "of",
  "in", "on", "at", "for", "with", "by", "from", "as", "this", "that", "it", "its", "i", "we",
  "you", "he", "she", "they", "not", "no",
]);

const WHITESPACE = /\s/u;
const NUMERIC = /\p{N}/u;
// Rust char::is_ascii_punctuation(): the ASCII graphic punctuation set.
const ASCII_PUNCT = /[!-/:-@[-`{-~]/;

function isAsciiUpper(ch: string): boolean {
  return ch >= "A" && ch <= "Z";
}

function isCjk(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  return cp >= 0x4e00 && cp <= 0x9fff;
}

/**
 * Returns true if `term` is a plausible new hotword candidate. Filters, in
 * order: length 2–30 Unicode scalars; not all whitespace/ASCII-punct/numeric;
 * not already in `existing` (case-sensitive exact); not in COMMON_WORDS
 * (case-insensitive); carries a signature char (CJK / ASCII upper / numeric).
 */
export function isValidHotwordCandidate(
  rawTerm: string,
  existing: ReadonlySet<string>,
): boolean {
  const term = rawTerm.trim();
  const chars = [...term];

  // 1. Length gate (Unicode scalar count, not UTF-16 length).
  if (chars.length < 2 || chars.length > 30) return false;

  // 2. Reject pure whitespace / ASCII punctuation / digits.
  const allTrivial = chars.every(
    (c) => WHITESPACE.test(c) || ASCII_PUNCT.test(c) || NUMERIC.test(c),
  );
  if (allTrivial) return false;

  // 3. Already known (case-sensitive exact membership).
  if (existing.has(term)) return false;

  // 4. Blacklist check (case-insensitive).
  if (COMMON_WORDS.has(term.toLowerCase())) return false;

  // 5. Signature: at least one CJK char, ASCII uppercase, or digit.
  const hasSignature = chars.some(
    (c) => isCjk(c) || isAsciiUpper(c) || NUMERIC.test(c),
  );
  return hasSignature;
}
