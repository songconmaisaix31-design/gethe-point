const DEFAULT_MAX_DEPTH = 12;
const DEFAULT_MAX_NODES = 512;
const DEFAULT_MAX_TOTAL_STRING_CODE_POINTS = 32_000;
const MIN_CONTAINMENT_CODE_POINTS = 4;
const MAX_APPROXIMATE_CODE_POINT_COMPARISONS = 2_000_000;

export interface DisclosureInspectionLimits {
  readonly maxDepth?: number;
  readonly maxNodes?: number;
  readonly maxTotalStringCodePoints?: number;
}

export type DisclosureFailureReason =
  | "private_text_match"
  | "non_json_value"
  | "traversal_limit";

export type DisclosureInspection =
  | Readonly<{ safe: true }>
  | Readonly<{
      safe: false;
      reason: DisclosureFailureReason;
      path: readonly (number | string)[];
    }>;

/**
 * Produces a conservative Default Full Case Folding equivalence key.
 *
 * ECMAScript does not expose Unicode CaseFolding.txt directly. Compatibility
 * normalization followed by full uppercase expansion and lowercase closure
 * covers the default full-fold equivalence classes, including multi-code-point
 * mappings such as sharp-s and Greek final sigma. The closure can merge a few
 * additional locale-sensitive forms, which is an intentional fail-closed
 * choice for a privacy guard.
 */
export const defaultFullCaseFold = (value: string): string =>
  value
    .normalize("NFKC")
    .toUpperCase()
    .toLowerCase()
    .normalize("NFKC");

/**
 * Removes presentation-only differences after case folding. A decomposed form
 * is used so canonical equivalents, width variants, marks, whitespace,
 * punctuation, and symbols cannot hide a near-verbatim disclosure.
 */
export const normalizeForDisclosure = (value: string): string => {
  const folded = defaultFullCaseFold(value).normalize("NFKD");
  const compact = folded.replace(/[\p{M}\p{P}\p{S}\p{Z}\s\p{Cc}\p{Cf}]/gu, "");

  return compact.length > 0 ? compact.normalize("NFC") : folded.replace(/\s/gu, "");
};

const toCodePoints = (value: string): readonly string[] => Array.from(value);

const isRangeWithinOneCodePointEdit = (
  left: readonly string[],
  leftStart: number,
  leftLength: number,
  right: readonly string[],
  rightStart: number,
  rightLength: number,
): boolean => {
  if (Math.abs(leftLength - rightLength) > 1) {
    return false;
  }

  if (leftLength === rightLength) {
    let differences = 0;

    for (let index = 0; index < leftLength; index += 1) {
      if (left[leftStart + index] !== right[rightStart + index]) {
        differences += 1;
        if (differences > 1) {
          return false;
        }
      }
    }

    return true;
  }

  const leftIsShorter = leftLength < rightLength;
  const shorter = leftIsShorter ? left : right;
  const shorterStart = leftIsShorter ? leftStart : rightStart;
  const shorterLength = leftIsShorter ? leftLength : rightLength;
  const longer = leftIsShorter ? right : left;
  const longerStart = leftIsShorter ? rightStart : leftStart;
  const longerLength = leftIsShorter ? rightLength : leftLength;
  let shorterIndex = 0;
  let longerIndex = 0;
  let skipped = false;

  while (shorterIndex < shorterLength && longerIndex < longerLength) {
    if (
      shorter[shorterStart + shorterIndex] ===
      longer[longerStart + longerIndex]
    ) {
      shorterIndex += 1;
      longerIndex += 1;
      continue;
    }

    if (skipped) {
      return false;
    }

    skipped = true;
    longerIndex += 1;
  }

  return true;
};

export const isWithinOneCodePointEdit = (
  leftValue: string,
  rightValue: string,
): boolean => {
  const left = toCodePoints(leftValue);
  const right = toCodePoints(rightValue);

  return isRangeWithinOneCodePointEdit(
    left,
    0,
    left.length,
    right,
    0,
    right.length,
  );
};

const containsWithinOneCodePointEdit = (
  haystackValue: string,
  needleValue: string,
): boolean => {
  const haystack = toCodePoints(haystackValue);
  const needle = toCodePoints(needleValue);

  if (needle.length < MIN_CONTAINMENT_CODE_POINTS) {
    return false;
  }

  const minimumWindow = Math.max(1, needle.length - 1);
  const maximumWindow = Math.min(haystack.length, needle.length + 1);
  let windowCount = 0;
  for (
    let windowLength = minimumWindow;
    windowLength <= maximumWindow;
    windowLength += 1
  ) {
    windowCount += Math.max(0, haystack.length - windowLength + 1);
  }
  if (
    windowCount * needle.length >
    MAX_APPROXIMATE_CODE_POINT_COMPARISONS
  ) {
    return true;
  }

  for (
    let windowLength = minimumWindow;
    windowLength <= maximumWindow;
    windowLength += 1
  ) {
    for (
      let start = 0;
      start + windowLength <= haystack.length;
      start += 1
    ) {
      if (
        isRangeWithinOneCodePointEdit(
          haystack,
          start,
          windowLength,
          needle,
          0,
          needle.length,
        )
      ) {
        return true;
      }
    }
  }

  return false;
};

const isNormalizedPrivateDisclosure = (
  candidate: string,
  privateText: string,
): boolean => {
  if (candidate.length === 0 || privateText.length === 0) {
    return false;
  }

  if (isWithinOneCodePointEdit(candidate, privateText)) {
    return true;
  }

  const candidateLength = toCodePoints(candidate).length;
  const privateLength = toCodePoints(privateText).length;

  if (
    Math.min(candidateLength, privateLength) >= MIN_CONTAINMENT_CODE_POINTS &&
    (candidate.includes(privateText) || privateText.includes(candidate))
  ) {
    return true;
  }

  return (
    containsWithinOneCodePointEdit(candidate, privateText) ||
    containsWithinOneCodePointEdit(privateText, candidate)
  );
};

export const isPrivateDisclosure = (
  candidateValue: string,
  privateValue: string,
): boolean =>
  isNormalizedPrivateDisclosure(
    normalizeForDisclosure(candidateValue),
    normalizeForDisclosure(privateValue),
  );

const isPlainObject = (value: object): boolean => {
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === null || prototype === Object.prototype;
};

/**
 * Recursively checks JSON-like provider or rendered output without ever
 * returning the inspected content. Unsupported shapes and traversal overflow
 * fail closed because provider output is untrusted.
 */
export const inspectPrivateDisclosure = (
  value: unknown,
  privateValues: readonly string[],
  limits: DisclosureInspectionLimits = {},
): DisclosureInspection => {
  const maxDepth = limits.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxNodes = limits.maxNodes ?? DEFAULT_MAX_NODES;
  const maxTotalStringCodePoints =
    limits.maxTotalStringCodePoints ?? DEFAULT_MAX_TOTAL_STRING_CODE_POINTS;
  const seen = new WeakSet<object>();
  const normalizedPrivateValues = privateValues.map(normalizeForDisclosure);
  let nodes = 0;
  let stringCodePoints = 0;

  const visit = (
    candidate: unknown,
    path: readonly (number | string)[],
    depth: number,
  ): DisclosureInspection => {
    nodes += 1;
    if (depth > maxDepth || nodes > maxNodes) {
      return { path, reason: "traversal_limit", safe: false };
    }

    if (typeof candidate === "string") {
      stringCodePoints += toCodePoints(candidate).length;
      if (stringCodePoints > maxTotalStringCodePoints) {
        return { path, reason: "traversal_limit", safe: false };
      }

      const normalizedCandidate = normalizeForDisclosure(candidate);
      return normalizedPrivateValues.some((privateValue) =>
        isNormalizedPrivateDisclosure(normalizedCandidate, privateValue),
      )
        ? { path, reason: "private_text_match", safe: false }
        : { safe: true };
    }

    if (
      candidate === null ||
      typeof candidate === "boolean" ||
      typeof candidate === "number"
    ) {
      return { safe: true };
    }

    if (Array.isArray(candidate)) {
      if (seen.has(candidate)) {
        return { path, reason: "non_json_value", safe: false };
      }
      seen.add(candidate);

      for (let index = 0; index < candidate.length; index += 1) {
        const result = visit(candidate[index], [...path, index], depth + 1);
        if (!result.safe) {
          return result;
        }
      }

      return { safe: true };
    }

    if (typeof candidate !== "object" || !isPlainObject(candidate)) {
      return { path, reason: "non_json_value", safe: false };
    }

    if (seen.has(candidate)) {
      return { path, reason: "non_json_value", safe: false };
    }
    seen.add(candidate);

    for (const key of Reflect.ownKeys(candidate)) {
      const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
      if (descriptor?.enumerable !== true) {
        continue;
      }
      if (!("value" in descriptor)) {
        return { path, reason: "non_json_value", safe: false };
      }

      const pathKey = typeof key === "symbol" ? "<symbol>" : key;
      const result = visit(descriptor.value, [...path, pathKey], depth + 1);
      if (!result.safe) {
        return result;
      }
    }

    return { safe: true };
  };

  return visit(value, [], 0);
};

export class PrivateDisclosureError extends Error {
  readonly code = "provider_invalid_output" as const;

  constructor() {
    super("Provider-derived output failed the private disclosure boundary.");
    this.name = "PrivateDisclosureError";
  }
}

export const assertNoPrivateDisclosure = (
  value: unknown,
  privateValues: readonly string[],
  limits?: DisclosureInspectionLimits,
): void => {
  const result = inspectPrivateDisclosure(value, privateValues, limits);
  if (!result.safe) {
    throw new PrivateDisclosureError();
  }
};
