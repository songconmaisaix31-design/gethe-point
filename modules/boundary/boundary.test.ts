import { describe, expect, it } from "vitest";

import {
  DEFAULT_FULL_CASE_FOLDING_ENTRIES,
  UNICODE_CASE_FOLDING_SOURCE_SHA256,
  UNICODE_CASE_FOLDING_VERSION,
  inspectDisclosure,
  unicodeDefaultFullCaseFold,
} from "./index";

const inspectionFor = (candidate: unknown, protectedValue: string) =>
  inspectDisclosure({
    protectedValues: [protectedValue],
    value: candidate,
  });

describe("Unicode Default Full Case Folding", () => {
  it("pins the complete Unicode 17.0.0 default full mapping", () => {
    expect(UNICODE_CASE_FOLDING_VERSION).toBe("17.0.0");
    expect(UNICODE_CASE_FOLDING_SOURCE_SHA256).toBe(
      "ff8d8fefbf123574205085d6714c36149eb946d717a0c585c27f0f4ef58c4183",
    );
    expect(DEFAULT_FULL_CASE_FOLDING_ENTRIES).toHaveLength(1_585);
  });

  it.each(["STRAẞE family detail", "Straße family detail", "STRASSE family detail"])(
    "maps sharp-S variants with multi-code-point folding: %s",
    (value) => {
      expect(unicodeDefaultFullCaseFold(value)).toBe("strasse family detail");
    },
  );

  it("handles final sigma plus canonical and compatibility normalization", () => {
    expect(unicodeDefaultFullCaseFold("ΟΣ")).toBe(
      unicodeDefaultFullCaseFold("ος"),
    );
    expect(unicodeDefaultFullCaseFold("Café")).toBe(
      unicodeDefaultFullCaseFold("Cafe\u0301"),
    );
    expect(unicodeDefaultFullCaseFold("ＦＡＭＩＬＹ")).toBe("family");
  });

  it("does not erase whitespace, punctuation, or symbols", () => {
    expect(unicodeDefaultFullCaseFold("a b")).not.toBe(
      unicodeDefaultFullCaseFold("ab"),
    );
    expect(unicodeDefaultFullCaseFold("a!")).not.toBe(
      unicodeDefaultFullCaseFold("a"),
    );
    expect(unicodeDefaultFullCaseFold("a★")).not.toBe(
      unicodeDefaultFullCaseFold("a"),
    );
  });
});

describe("disclosure inspection", () => {
  it("rejects every sharp-S family variant in both directions", () => {
    const variants = [
      "STRAẞE family detail",
      "Straße family detail",
      "STRASSE family detail",
    ];

    for (const protectedValue of variants) {
      for (const candidate of variants) {
        expect(inspectionFor(candidate, protectedValue).safe).toBe(false);
      }
    }
  });

  it.each([
    "STRASSE  family detail",
    "STRASSE family detail!",
    "STRASSE family detail★",
    "STRASSE family detaiLx",
    "prefix STRASSE family detail suffix",
    "STRASSE family",
    "ＳＴＲＡＳＳＥ family detail",
  ])("rejects normalized, edit, and containment variant: %s", (candidate) => {
    expect(inspectionFor(candidate, "Straße family detail").safe).toBe(false);
  });

  it("recursively inspects nested values and provider-controlled keys", () => {
    expect(
      inspectionFor(
        { safe: [{ nested: "STRASSE family detail" }] },
        "Straße family detail",
      ).safe,
    ).toBe(false);
    expect(
      inspectionFor(
        { "STRASSE family detail": { nested: true } },
        "Straße family detail",
      ).safe,
    ).toBe(false);
  });

  it("fails closed on cycles, accessors, and traversal limits", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(inspectionFor(cyclic, "private detail")).toEqual({
      safe: false,
      reason: "unsupported_provider_value",
    });

    const accessor = Object.defineProperty({}, "value", {
      get: () => "private detail",
    });
    expect(inspectionFor(accessor, "private detail")).toEqual({
      safe: false,
      reason: "unsupported_provider_value",
    });

    expect(
      inspectDisclosure({
        limits: { maxStringCodePoints: 3 },
        protectedValues: ["private detail"],
        value: "safe",
      }),
    ).toEqual({ safe: false, reason: "boundary_limit_exceeded" });
  });

  it("allows unrelated bounded output", () => {
    expect(
      inspectionFor(
        { kind: "potential_task", topic: "schedule coordination" },
        "Straße family detail",
      ),
    ).toEqual({ safe: true });
  });
});
