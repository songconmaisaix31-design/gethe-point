import { z } from "zod";

const MAX_PROVIDER_INPUT_LENGTH = 2_000;
const MAX_MINIMUM_EXCERPT_LENGTH = 160;

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

const SENSITIVE_LITERAL_PATTERNS = Object.freeze([
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  /https?:\/\/\S+/iu,
  /\b(?:token|password|secret|api[-_ ]?key)\s*[:=]\s*\S+/iu,
  /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/u,
  /(?<!\d)\d{17}[0-9Xx](?!\d)/u,
  /(?<!\d)\d{6,}(?!\d)/u,
] as const);

const HIGH_RISK_PATTERNS = Object.freeze([
  /(?:不想活|想死|自杀|结束生命|伤害自己|伤害别人)/u,
  /\b(?:suicid(?:e|al)|kill myself|hurt myself|self[- ]harm)\b/iu,
] as const);

const normalize = (value: string): string =>
  value.normalize("NFKC").replace(/\s+/gu, " ").trim();

const redactOne = (value: string): string =>
  REDACTIONS.reduce(
    (redacted, { pattern, replacement }) => redacted.replace(pattern, replacement),
    normalize(value),
  );

export const ProviderRedactedInputSchema = z.string().trim().min(1).max(
  MAX_PROVIDER_INPUT_LENGTH,
);

export const redactForProvider = (values: readonly string[]): string => {
  const redacted = values
    .map((value, index) => `source_${String(index + 1)}: ${redactOne(value)}`)
    .join("\n")
    .slice(0, MAX_PROVIDER_INPUT_LENGTH)
    .trim();

  return ProviderRedactedInputSchema.parse(redacted.length > 0 ? redacted : "[redacted]");
};

export const isMinimumRedactedExcerpt = (
  excerpt: string,
  privateInputs: readonly string[],
): boolean => {
  const normalizedExcerpt = normalize(excerpt);

  if (
    normalizedExcerpt.length === 0 ||
    normalizedExcerpt.length > MAX_MINIMUM_EXCERPT_LENGTH ||
    SENSITIVE_LITERAL_PATTERNS.some((pattern) => pattern.test(normalizedExcerpt))
  ) {
    return false;
  }

  return privateInputs.every(
    (privateInput) => normalize(privateInput) !== normalizedExcerpt,
  );
};

export const containsHighRiskContent = (values: readonly string[]): boolean =>
  values.some((value) =>
    HIGH_RISK_PATTERNS.some((pattern) => pattern.test(normalize(value))),
  );

export const HIGH_RISK_SPEAKER_GUIDANCE =
  "这段内容可能需要尽快获得现实中的支持。请联系可信任的人；若存在即时危险，请联系当地紧急服务。此提示不作诊断，也不会自动创建家庭任务或共享记录。";
