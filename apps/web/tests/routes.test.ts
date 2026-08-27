import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { selectFixtureRole } from "../src/features/experience/role-selection";

describe("Fixture route parity and mobile role selection", () => {
  it("renders the same FixtureExperience from both public entries", async () => {
    const [homePage, canonicalPage] = await Promise.all([
      readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/app/(ui)/fixtures/mvp-core/page.tsx", import.meta.url), "utf8"),
    ]);

    expect(homePage).toContain("<FixtureExperience");
    expect(canonicalPage).toContain("<FixtureExperience");
    expect(homePage).toContain("selectFixtureRole(params.role)");
    expect(canonicalPage).toContain("selectFixtureRole(params.role)");
  });

  it("allowlists subject, primary, and partner without treating the query as identity", () => {
    expect(selectFixtureRole("subject")).toBe("subject");
    expect(selectFixtureRole("primary")).toBe("primary");
    expect(selectFixtureRole("partner")).toBe("partner");
    expect(selectFixtureRole("admin")).toBe("primary");
    expect(selectFixtureRole(["partner", "subject"])).toBe("partner");
  });
});
