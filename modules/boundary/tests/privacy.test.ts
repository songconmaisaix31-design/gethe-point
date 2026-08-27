import { describe, expect, it } from "vitest";

import {
  containsHighRiskContent,
  isMinimumRedactedExcerpt,
  redactForProvider,
} from "../src/index";

describe("privacy and safety boundaries", () => {
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

  it("rejects verbatim or sensitive shared excerpts", () => {
    expect(isMinimumRedactedExcerpt("原始私聊全文", ["原始私聊全文"])).toBe(false);
    expect(
      isMinimumRedactedExcerpt("请联系 13812345678", ["另一个原始内容"]),
    ).toBe(false);
    expect(
      isMinimumRedactedExcerpt("发言人希望家人确认后续安排。", ["原始私聊全文"]),
    ).toBe(true);
  });

  it("routes representative high-risk phrases without diagnosing them", () => {
    expect(containsHighRiskContent(["我现在想伤害自己。"])).toBe(true);
    expect(containsHighRiskContent(["只是讨论明天的安排。"])).toBe(false);
  });
});
