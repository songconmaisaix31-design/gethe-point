import { unicodeDefaultFullCaseFold } from "./unicode-case-folding";

const DEFAULT_MAX_DEPTH = 12;
const DEFAULT_MAX_NODES = 2_048;
const DEFAULT_MAX_STRINGS = 512;
const DEFAULT_MAX_STRING_CODE_POINTS = 4_096;

export type DisclosureReason =
  | "boundary_limit_exceeded"
  | "folded_containment"
  | "folded_equal"
  | "one_code_point_edit"
  | "unsupported_provider_value";

export type DisclosureInspection =
  | Readonly<{ safe: true }>
  | Readonly<{ safe: false; reason: DisclosureReason }>;

export interface DisclosureInspectionLimits {
  readonly maxDepth?: number;
  readonly maxNodes?: number;
  readonly maxStrings?: number;
  readonly maxStringCodePoints?: number;
}

export interface DisclosureInspectionInput {
  readonly value: unknown;
  readonly protectedValues: readonly string[];
  readonly limits?: DisclosureInspectionLimits;
}

const codePoints = (value: string): string[] => Array.from(value);

const isAtMostOneCodePointEdit = (
  leftValue: string,
  rightValue: string,
): boolean => {
  const left = codePoints(leftValue);
  const right = codePoints(rightValue);

  if (Math.abs(left.length - right.length) > 1) {
    return false;
  }

  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;

  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }

    edits += 1;
    if (edits > 1) {
      return false;
    }

    if (left.length > right.length) {
      leftIndex += 1;
    } else if (right.length > left.length) {
      rightIndex += 1;
    } else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }

  if (leftIndex < left.length || rightIndex < right.length) {
    edits += 1;
  }

  return edits <= 1;
};

const inspectString = (
  candidate: string,
  protectedFoldedValues: readonly string[],
): DisclosureInspection => {
  const candidateFolded = unicodeDefaultFullCaseFold(candidate);

  if (candidateFolded.length === 0) {
    return { safe: true };
  }

  for (const protectedFolded of protectedFoldedValues) {
    if (candidateFolded === protectedFolded) {
      return { safe: false, reason: "folded_equal" };
    }

    if (
      candidateFolded.includes(protectedFolded) ||
      protectedFolded.includes(candidateFolded)
    ) {
      return { safe: false, reason: "folded_containment" };
    }

    if (isAtMostOneCodePointEdit(candidateFolded, protectedFolded)) {
      return { safe: false, reason: "one_code_point_edit" };
    }
  }

  return { safe: true };
};

/**
 * Inspects every provider-controlled string key and value without invoking
 * accessors. Unsupported object shapes and traversal limits fail closed.
 */
export const inspectDisclosure = ({
  limits,
  protectedValues,
  value,
}: DisclosureInspectionInput): DisclosureInspection => {
  const maxDepth = limits?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxNodes = limits?.maxNodes ?? DEFAULT_MAX_NODES;
  const maxStrings = limits?.maxStrings ?? DEFAULT_MAX_STRINGS;
  const maxStringCodePoints =
    limits?.maxStringCodePoints ?? DEFAULT_MAX_STRING_CODE_POINTS;
  const protectedFoldedValues = protectedValues
    .map(unicodeDefaultFullCaseFold)
    .filter((protectedValue) => protectedValue.length > 0);
  const visited = new WeakSet<object>();
  let nodes = 0;
  let strings = 0;

  const visit = (current: unknown, depth: number): DisclosureInspection => {
    nodes += 1;
    if (depth > maxDepth || nodes > maxNodes) {
      return { safe: false, reason: "boundary_limit_exceeded" };
    }

    if (typeof current === "string") {
      strings += 1;
      if (
        strings > maxStrings ||
        codePoints(current).length > maxStringCodePoints
      ) {
        return { safe: false, reason: "boundary_limit_exceeded" };
      }

      return inspectString(current, protectedFoldedValues);
    }

    if (
      current === null ||
      typeof current === "boolean" ||
      typeof current === "number"
    ) {
      return { safe: true };
    }

    if (typeof current !== "object") {
      return { safe: false, reason: "unsupported_provider_value" };
    }

    if (visited.has(current)) {
      return { safe: false, reason: "unsupported_provider_value" };
    }
    visited.add(current);

    let descriptors: PropertyDescriptorMap;
    try {
      descriptors = Object.getOwnPropertyDescriptors(current);
    } catch {
      return { safe: false, reason: "unsupported_provider_value" };
    }

    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string") {
        return { safe: false, reason: "unsupported_provider_value" };
      }

      const keyInspection = visit(key, depth + 1);
      if (!keyInspection.safe) {
        return keyInspection;
      }

      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        descriptor.get !== undefined ||
        descriptor.set !== undefined ||
        !("value" in descriptor)
      ) {
        return { safe: false, reason: "unsupported_provider_value" };
      }

      const valueInspection = visit(descriptor.value, depth + 1);
      if (!valueInspection.safe) {
        return valueInspection;
      }
    }

    return { safe: true };
  };

  return visit(value, 0);
};

export class DisclosureBoundaryError extends Error {
  readonly code = "disclosure_boundary_rejected" as const;
  readonly reason: DisclosureReason;

  constructor(reason: DisclosureReason) {
    super("The value did not pass the disclosure boundary.");
    this.name = "DisclosureBoundaryError";
    this.reason = reason;
  }
}

export const assertNoDisclosure = (
  input: DisclosureInspectionInput,
): void => {
  const inspection = inspectDisclosure(input);

  if (!inspection.safe) {
    throw new DisclosureBoundaryError(inspection.reason);
  }
};
