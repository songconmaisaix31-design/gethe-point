import { describe, expect, it } from "vitest";

describe("workspace harness", () => {
  it("runs tests in the supported Node runtime", () => {
    const nodeMajor = Number.parseInt(process.versions.node, 10);

    expect(nodeMajor).toBe(24);
  });
});
