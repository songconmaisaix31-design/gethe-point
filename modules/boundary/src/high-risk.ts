import { HIGH_RISK_CONTENT_POLICY } from "../../../packages/contracts/src/index";

import { defaultFullCaseFold } from "./unicode-disclosure";

export type HighRiskCategory =
  (typeof HIGH_RISK_CONTENT_POLICY.categories)[number];

const PHRASES = Object.freeze({
  self_harm: Object.freeze([
    "kill myself",
    "hurt myself",
    "harm myself",
    "cut myself",
    "want to die",
    "end my life",
    "take my own life",
    "take my life",
    "ending it all",
    "overdose on purpose",
    "suicide",
    "suicidal",
    "自杀",
    "自残",
    "伤害自己",
    "不想活",
    "结束生命",
  ]),
  domestic_violence: Object.freeze([
    "domestic violence",
    "family violence",
    "partner hit me",
    "partner hits me",
    "partner beat me",
    "partner beats me",
    "hit by my partner",
    "husband hit me",
    "husband hits me",
    "wife hit me",
    "wife hits me",
    "he hit me",
    "she hit me",
    "choked me",
    "strangled me",
    "threatened to hurt me",
    "unsafe at home",
    "abusive partner",
    "家暴",
    "家庭暴力",
    "伴侣打我",
    "丈夫打我",
    "妻子打我",
    "掐住我",
    "勒住我",
    "威胁伤害我",
    "被伴侣打",
    "殴打我",
    "不让我离开",
  ]),
  acute_medical_symptom: Object.freeze([
    "cannot breathe",
    "cant breathe",
    "difficulty breathing",
    "not breathing",
    "stopped breathing",
    "shortness of breath",
    "chest pain",
    "severe chest pressure",
    "severe bleeding",
    "unconscious",
    "fainted",
    "passed out",
    "heart attack",
    "stroke symptoms",
    "face drooping",
    "sudden weakness",
    "drug overdose",
    "seizure",
    "anaphylaxis",
    "severe allergic reaction",
    "blue lips",
    "coughing blood",
    "vomiting blood",
    "无法呼吸",
    "不能呼吸",
    "呼吸困难",
    "胸痛",
    "大出血",
    "失去意识",
    "昏迷",
    "晕倒",
    "嘴唇发紫",
    "咳血",
    "吐血",
    "心脏病发作",
    "中风症状",
    "药物过量",
    "抽搐",
    "过敏性休克",
  ]),
} as const satisfies Readonly<
  Record<HighRiskCategory, readonly string[]>
>);

const normalizeSafetyText = (value: string): string =>
  defaultFullCaseFold(value)
    .normalize("NFKD")
    .replace(/[\p{M}\p{P}\p{S}\p{Z}\s\p{Cc}\p{Cf}]/gu, "");

const NORMALIZED_PHRASES: Readonly<
  Record<HighRiskCategory, readonly string[]>
> = Object.freeze({
  acute_medical_symptom: PHRASES.acute_medical_symptom.map(normalizeSafetyText),
  domestic_violence: PHRASES.domestic_violence.map(normalizeSafetyText),
  self_harm: PHRASES.self_harm.map(normalizeSafetyText),
});

/** Deterministic classifier for the three frozen high-risk categories. */
export const detectHighRiskCategories = (
  privateValues: readonly string[],
): readonly HighRiskCategory[] => {
  const normalizedInputs = privateValues.map(normalizeSafetyText);

  return HIGH_RISK_CONTENT_POLICY.categories.filter((category) =>
    NORMALIZED_PHRASES[category].some((phrase) =>
      normalizedInputs.some((value) => value.includes(phrase)),
    ),
  );
};

export const isHighRiskContent = (privateValues: readonly string[]): boolean =>
  detectHighRiskCategories(privateValues).length > 0;
