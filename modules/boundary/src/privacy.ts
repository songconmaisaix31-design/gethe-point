import { z } from "zod";

const MAX_PROVIDER_INPUT_LENGTH = 2_000;
const MIN_CONTAINED_DISCLOSURE_LENGTH = 4;

const REDACTIONS = Object.freeze([
  {
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
    replacement: "[email]",
  },
  { pattern: /https?:\/\/\S+/giu, replacement: "[link]" },
  {
    pattern: /\b(?:token|password|secret|api[-_ ]?key)\s*[:=]\s*\S+/giu,
    replacement: "[credential]",
  },
  {
    pattern: /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/gu,
    replacement: "[phone]",
  },
  {
    pattern: /(?<!\d)\d{17}[0-9Xx](?!\d)/gu,
    replacement: "[identity-number]",
  },
  { pattern: /(?<!\d)\d{6,}(?!\d)/gu, replacement: "[number]" },
] as const);

export const HighRiskCategorySchema = z.enum([
  "self_harm",
  "domestic_violence",
  "acute_medical_symptom",
]);
export type HighRiskCategory = z.infer<typeof HighRiskCategorySchema>;

const HIGH_RISK_PATTERNS: Readonly<
  Record<HighRiskCategory, readonly RegExp[]>
> = Object.freeze({
  self_harm: Object.freeze([
    /(?:不想活|想死|自杀|结束生命|伤害自己|割腕|吞药轻生)/u,
    /\b(?:suicid(?:e|al)|kill myself|end my life|hurt myself|self[- ]?harm)\b/iu,
    /\b(?:want to die|do not want to live|don't want to live|take my own life)\b/iu,
  ]),
  domestic_violence: Object.freeze([
    /(?:家暴|家庭暴力|伴侣暴力|被(?:伴侣|丈夫|妻子|老公|老婆|家人).{0,8}(?:打|殴打|掐|勒|威胁)|(?:伴侣|丈夫|妻子|老公|老婆|家人|他|她).{0,8}(?:打我|殴打我|掐我|勒我|威胁我)|锁在家里|不让我离开)/u,
    /\b(?:domestic violence|abuse at home|my (?:partner|husband|wife) (?:hit|hits|beat|beats|choked|strangled|threatened) me|locked me (?:in|inside)|won't let me leave)\b/iu,
    /\b(?:he|she|they) (?:hit|hits|beat|beats|choked|strangled|threatened) me\b/iu,
  ]),
  acute_medical_symptom: Object.freeze([
    /(?:胸痛|胸口(?:剧痛|疼痛)|呼吸困难|喘不上气|无法呼吸|失去意识|昏迷|大出血|严重出血|疑似中风|突发剧烈头痛|抽搐|严重过敏)/u,
    /\b(?:chest pain|heart attack|difficulty breathing|can't breathe|cannot breathe|unconscious|lost consciousness|severe bleeding|possible stroke|stroke symptoms|sudden severe headache|seizure|anaphylaxis)\b/iu,
  ]),
});

export const HIGH_RISK_SPEAKER_GUIDANCE: Readonly<
  Record<HighRiskCategory, string>
> = Object.freeze({
  self_harm:
    "请立即联系可信任的人并尽量不要独处；若存在即时危险，请联系当地紧急服务。本提示不作诊断，也不会自动创建任务或共享记录。",
  domestic_violence:
    "请优先前往安全地点，并联系可信任的人或当地专业支持；若存在即时危险，请联系当地紧急服务。本提示不作判断，也不会自动创建任务或共享记录。",
  acute_medical_symptom:
    "这可能需要立即获得现实中的医疗帮助；若症状正在发生，请联系当地紧急医疗服务。本提示不作诊断，也不会自动创建任务或共享记录。",
});

const normalizeWhitespace = (value: string): string =>
  value.normalize("NFKC").replace(/\s+/gu, " ").trim();

/**
 * Canonicalizes disclosure comparisons without changing the value that is stored.
 * Removing presentation differences makes privacy checks fail closed for visually
 * equivalent private text.
 */
export const normalizeForDisclosureComparison = (value: string): string =>
  Array.from(
    normalizeWhitespace(value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Mark}+/gu, "")
      .replace(/[\p{White_Space}\p{Punctuation}\p{Symbol}]+/gu, ""),
  ).join("");

const isWithinOneEdit = (leftValue: string, rightValue: string): boolean => {
  const left = Array.from(leftValue);
  const right = Array.from(rightValue);

  if (Math.abs(left.length - right.length) > 1) {
    return false;
  }

  if (left.length === right.length) {
    let differences = 0;

    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) {
        differences += 1;

        if (differences > 1) {
          return false;
        }
      }
    }

    return differences <= 1;
  }

  const [shorter, longer] =
    left.length < right.length ? [left, right] : [right, left];
  let shorterIndex = 0;
  let longerIndex = 0;
  let skipped = false;

  while (shorterIndex < shorter.length && longerIndex < longer.length) {
    if (shorter[shorterIndex] === longer[longerIndex]) {
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

export const isPrivateDisclosure = (
  candidate: string,
  privateInputs: readonly string[],
): boolean => {
  const normalizedCandidate = normalizeForDisclosureComparison(candidate);

  if (normalizedCandidate.length === 0) {
    const hasVisibleCandidate = normalizeWhitespace(candidate).length > 0;

    return (
      hasVisibleCandidate &&
      privateInputs.some(
        (privateInput) =>
          normalizeWhitespace(privateInput).length > 0 &&
          normalizeForDisclosureComparison(privateInput).length === 0,
      )
    );
  }

  return privateInputs.some((privateInput) => {
    const normalizedPrivate = normalizeForDisclosureComparison(privateInput);

    if (normalizedPrivate.length === 0) {
      return false;
    }

    if (isWithinOneEdit(normalizedCandidate, normalizedPrivate)) {
      return true;
    }

    const shorterLength = Math.min(
      normalizedCandidate.length,
      normalizedPrivate.length,
    );

    return (
      shorterLength >= MIN_CONTAINED_DISCLOSURE_LENGTH &&
      (normalizedCandidate.includes(normalizedPrivate) ||
        normalizedPrivate.includes(normalizedCandidate))
    );
  });
};

const derivedValueIsSafe = (
  value: unknown,
  privateInputs: readonly string[],
  visited: Set<object>,
): boolean => {
  if (typeof value === "string") {
    return !isPrivateDisclosure(value, privateInputs);
  }

  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "undefined"
  ) {
    return true;
  }

  if (typeof value !== "object" || visited.has(value)) {
    return false;
  }

  visited.add(value);
  const safe = Array.isArray(value)
    ? value.every((item) => derivedValueIsSafe(item, privateInputs, visited))
    : Object.values(value).every((item) =>
        derivedValueIsSafe(item, privateInputs, visited),
      );
  visited.delete(value);
  return safe;
};

/** Checks every string nested in provider-derived data with the same policy. */
export const areProviderDerivedFieldsSafe = (
  value: unknown,
  privateInputs: readonly string[],
): boolean => derivedValueIsSafe(value, privateInputs, new Set());

const redactOne = (value: string): string =>
  REDACTIONS.reduce(
    (redacted, { pattern, replacement }) => redacted.replace(pattern, replacement),
    normalizeWhitespace(value),
  );

const truncateCodePoints = (value: string, limit: number): string =>
  Array.from(value).slice(0, limit).join("");

export const ProviderRedactedInputSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_PROVIDER_INPUT_LENGTH);

export const redactForProvider = (values: readonly string[]): string => {
  const redacted = truncateCodePoints(
    values
      .map((value, index) => `source_${String(index + 1)}: ${redactOne(value)}`)
      .join("\n"),
    MAX_PROVIDER_INPUT_LENGTH,
  ).trim();

  return ProviderRedactedInputSchema.parse(
    redacted.length > 0 ? redacted : "[redacted]",
  );
};

export interface HighRiskDetection {
  readonly category: HighRiskCategory;
  readonly guidance: string;
}

export const detectHighRiskContent = (
  values: readonly string[],
): HighRiskDetection | undefined => {
  for (const category of HighRiskCategorySchema.options) {
    const patterns = HIGH_RISK_PATTERNS[category];

    if (
      values.some((value) =>
        patterns.some((pattern) => pattern.test(normalizeWhitespace(value))),
      )
    ) {
      return Object.freeze({
        category,
        guidance: HIGH_RISK_SPEAKER_GUIDANCE[category],
      });
    }
  }

  return undefined;
};

export const containsHighRiskContent = (values: readonly string[]): boolean =>
  detectHighRiskContent(values) !== undefined;
