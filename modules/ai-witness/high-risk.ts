import { unicodeDefaultFullCaseFold } from "../boundary/index";

export const HIGH_RISK_CATEGORIES = [
  "self_harm",
  "domestic_violence",
  "acute_medical_symptom",
] as const;

export type HighRiskCategory = (typeof HIGH_RISK_CATEGORIES)[number];

const HIGH_RISK_PHRASES: Readonly<Record<HighRiskCategory, readonly string[]>> =
  Object.freeze({
    self_harm: Object.freeze([
      "kill myself",
      "end my life",
      "take my life",
      "hurt myself",
      "self harm",
      "suicide",
      "suicidal",
      "do not want to live",
      "don t want to live",
      "自杀",
      "不想活",
      "伤害自己",
    ]),
    domestic_violence: Object.freeze([
      "domestic violence",
      "family violence",
      "partner hit me",
      "spouse hit me",
      "hit me at home",
      "afraid of my partner",
      "unsafe with my partner",
      "abusive partner",
      "家暴",
      "伴侣打我",
      "被伴侣威胁",
    ]),
    acute_medical_symptom: Object.freeze([
      "chest pain",
      "can t breathe",
      "cannot breathe",
      "difficulty breathing",
      "severe bleeding",
      "unconscious",
      "possible stroke",
      "stroke symptoms",
      "anaphylaxis",
      "overdose",
      "胸痛",
      "无法呼吸",
      "大出血",
      "昏迷",
      "中风",
    ]),
  });

const normalizeForClassification = (value: string): string =>
  unicodeDefaultFullCaseFold(value)
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

/** Deterministic routing only; this function never diagnoses a person. */
export const detectHighRiskCategory = (
  privateContent: string,
): HighRiskCategory | undefined => {
  const normalized = normalizeForClassification(privateContent);

  for (const category of HIGH_RISK_CATEGORIES) {
    if (
      HIGH_RISK_PHRASES[category].some((phrase) =>
        normalized.includes(normalizeForClassification(phrase)),
      )
    ) {
      return category;
    }
  }

  return undefined;
};
