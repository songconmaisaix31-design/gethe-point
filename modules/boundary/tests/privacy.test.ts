import { describe, expect, it } from "vitest";

import {
  areProviderDerivedFieldsSafe,
  createSafeContractError,
  detectHighRiskContent,
  isPrivateDisclosure,
  normalizeForDisclosureComparison,
  redactForProvider,
} from "../src/index";

const REQUEST_ID = "00000000-0000-4000-8000-000000000101";

describe("conversation privacy boundary", () => {
  it("redacts direct identifiers and credential-shaped values before providers", () => {
    const redacted = redactForProvider([
      "email@example.com 13812345678 token=private-token https://example.com",
    ]);

    expect(redacted).toContain("[email]");
    expect(redacted).toContain("[phone]");
    expect(redacted).toContain("[credential]");
    expect(redacted).toContain("[link]");
    expect(redacted).not.toContain("private-token");
  });

  it("rejects Unicode, case, whitespace, punctuation, and one-edit variants", () => {
    const privateInput = "Ｓｅｃｒｅｔ　Family，安排！";

    expect(normalizeForDisclosureComparison(privateInput)).toBe(
      "secretfamily安排",
    );
    expect(isPrivateDisclosure("secret family 安排", [privateInput])).toBe(true);
    expect(isPrivateDisclosure("SECRET-FAMILY...安排", [privateInput])).toBe(true);
    expect(isPrivateDisclosure("secret family 安非", [privateInput])).toBe(true);
    expect(isPrivateDisclosure("🔒", ["🔒"])).toBe(true);
    expect(isPrivateDisclosure("需要由家人确认后续安排。", [privateInput])).toBe(
      false,
    );
  });

  it("applies the disclosure guard to every nested provider-derived field", () => {
    const privateInputs = ["private family schedule"];

    expect(
      areProviderDerivedFieldsSafe(
        {
          conclusion: "PRIVATE family, schedule!",
          missingInfo: ["owner"],
        },
        privateInputs,
      ),
    ).toBe(false);
    expect(
      areProviderDerivedFieldsSafe(
        { intent: "coordinate_schedule", confidence: 0.8 },
        privateInputs,
      ),
    ).toBe(true);
  });

  it.each([
    ["self_harm", "我现在想伤害自己。"],
    ["domestic_violence", "我的伴侣昨晚打我，还不让我离开。"],
    ["acute_medical_symptom", "我突然胸痛而且喘不上气。"],
  ] as const)("detects %s deterministically", (category, content) => {
    expect(detectHighRiskContent([content])).toMatchObject({ category });
  });

  it("returns content-free stable errors", () => {
    const error = createSafeContractError("not_found", REQUEST_ID);

    expect(error).toEqual({
      code: "not_found",
      message: "The requested record was not found.",
      requestId: REQUEST_ID,
      retryable: false,
    });
  });
});
