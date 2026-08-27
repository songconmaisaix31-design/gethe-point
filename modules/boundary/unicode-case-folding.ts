import {
  DEFAULT_FULL_CASE_FOLDING_ENTRIES,
  UNICODE_CASE_FOLDING_SOURCE_SHA256,
  UNICODE_CASE_FOLDING_VERSION,
} from "./case-folding-data";

const DEFAULT_FULL_CASE_FOLDING = new Map(
  DEFAULT_FULL_CASE_FOLDING_ENTRIES,
);

/**
 * Applies Unicode Default Full Case Folding with the version-fixed Unicode
 * 17.0.0 C + F mapping. NFKC runs on both sides because case folding does not
 * itself preserve normalization forms.
 */
export const unicodeDefaultFullCaseFold = (value: string): string => {
  const normalized = value.normalize("NFKC");
  const folded: string[] = [];

  for (const character of normalized) {
    const codePoint = character.codePointAt(0);

    if (codePoint === undefined) {
      continue;
    }

    const mapping = DEFAULT_FULL_CASE_FOLDING.get(codePoint);
    folded.push(
      mapping === undefined ? character : String.fromCodePoint(...mapping),
    );
  }

  return folded.join("").normalize("NFKC");
};

export {
  DEFAULT_FULL_CASE_FOLDING_ENTRIES,
  UNICODE_CASE_FOLDING_SOURCE_SHA256,
  UNICODE_CASE_FOLDING_VERSION,
};
