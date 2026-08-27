import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("Fixture routes", () => {
  it("renders the shared FixtureExperience from both public entries", async () => {
    const [homePage, canonicalPage] = await Promise.all([
      readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("../src/app/(ui)/fixtures/mvp-core/page.tsx", import.meta.url),
        "utf8",
      ),
    ]);

    expect(homePage).toContain("<FixtureExperience />");
    expect(canonicalPage).toContain("<FixtureExperience />");
    expect(homePage).not.toContain("createLocalFixtureClient");
    expect(canonicalPage).not.toContain("createLocalFixtureClient");
  });
});
