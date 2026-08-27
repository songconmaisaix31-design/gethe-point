import { describe, expect, it } from "vitest";

import { detectHighRiskCategories } from "./high-risk";

describe("deterministic high-risk classification", () => {
  it.each([
    ["self_harm", "I want to end my life tonight."],
    ["self_harm", "我不想活了。"],
    ["domestic_violence", "My partner hit me again."],
    ["domestic_violence", "这是家暴，我很害怕。"],
    ["acute_medical_symptom", "I have chest pain and cannot breathe."],
    ["acute_medical_symptom", "我胸痛而且无法呼吸。"],
  ] as const)("detects %s without a provider", (category, content) => {
    expect(detectHighRiskCategories([content])).toContain(category);
  });

  it("normalizes width, punctuation, symbols, and spacing", () => {
    expect(
      detectHighRiskCategories(["Ｉ want—to…ＫＩＬＬ　myself"]),
    ).toContain("self_harm");
  });

  it("does not classify an ordinary household note", () => {
    expect(
      detectHighRiskCategories(["Please review the school calendar tomorrow."]),
    ).toEqual([]);
  });
});
