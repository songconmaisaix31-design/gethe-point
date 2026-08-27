import { describe, expect, it } from "vitest";

import {
  inspectPrivateDisclosure,
  isPrivateDisclosure,
  normalizeForDisclosure,
} from "./unicode-disclosure";

describe("Unicode private disclosure boundary", () => {
  it.each([
    ["Straße family detail", "STRASSE family detail"],
    ["STRASSE family detail", "Straße family detail"],
    ["οσ family detail", "ος family detail"],
    ["Café family detail", "Cafe\u0301 family detail"],
    ["ＦＡＭＩＬＹ private detail", "family private detail"],
    ["Private Household Detail", "private household detail"],
    ["private household detail", "p r i v a t e household detail"],
    ["private#household$detail", "private household detail"],
    ["private household detail", "prefix private household detail suffix"],
    ["prefix private household detail suffix", "private household detail"],
    ["private household detail", "private househould detail"],
  ])("rejects normalized near-verbatim values", (privateValue, candidate) => {
    expect(isPrivateDisclosure(candidate, privateValue)).toBe(true);
  });

  it("uses multi-code-point case folding rather than lowercase alone", () => {
    expect("Straße".toLowerCase()).not.toBe("STRASSE".toLowerCase());
    expect(normalizeForDisclosure("Straße")).toBe(
      normalizeForDisclosure("STRASSE"),
    );
  });

  it("checks every nested provider-derived string without returning content", () => {
    const inspection = inspectPrivateDisclosure(
      {
        safe: "A general household observation.",
        nested: [{ deeper: "STRASSE family detail" }],
      },
      ["Straße family detail"],
    );

    expect(inspection).toEqual({
      path: ["nested", 0, "deeper"],
      reason: "private_text_match",
      safe: false,
    });
    expect(JSON.stringify(inspection)).not.toContain("STRASSE");
    expect(JSON.stringify(inspection)).not.toContain("Straße");
  });

  it("allows a bounded non-verbatim interpretation", () => {
    expect(
      inspectPrivateDisclosure(
        { conclusion: "A household follow-up may need human review." },
        ["Pick up the prescription from Harbor Pharmacy before six."],
      ),
    ).toEqual({ safe: true });
  });

  it("fails closed on cyclic or oversized provider values", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    expect(inspectPrivateDisclosure(cyclic, ["private detail"])).toMatchObject({
      reason: "non_json_value",
      safe: false,
    });
    expect(
      inspectPrivateDisclosure("safe text", ["private detail"], {
        maxTotalStringCodePoints: 2,
      }),
    ).toMatchObject({ reason: "traversal_limit", safe: false });
  });
});
