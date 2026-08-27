import { describe, expect, it } from "vitest";

import {
  FIXTURE_SHARED_SIGNAL,
  FIXTURE_SIGNAL_DRAFT,
} from "../../../packages/contracts/src/index";
import { ResponsibilityDraftInputSchema } from "../../responsibility/src/index";
import {
  createCanonicalFixtureResponsibilityDraftPort,
  draftCanonicalFixtureResponsibility,
} from "../src/index";

describe("deterministic Fixture responsibility draft", () => {
  it("returns the canonical domain and task without mutation authority", async () => {
    const port = createCanonicalFixtureResponsibilityDraftPort();
    const result = await port.draft(
      ResponsibilityDraftInputSchema.parse({
        signal: FIXTURE_SHARED_SIGNAL,
        sourceDraft: FIXTURE_SIGNAL_DRAFT,
      }),
    );

    expect(result).toMatchObject({
      consequentialMutationAllowed: false,
      source: "fixture",
      status: "ready",
    });
  });

  it("fails closed for non-Fixture, incomplete, and malformed inputs", () => {
    expect(
      draftCanonicalFixtureResponsibility({
        signal: FIXTURE_SHARED_SIGNAL,
        sourceDraft: { ...FIXTURE_SIGNAL_DRAFT, source: "human" },
      }),
    ).toMatchObject({
      consequentialMutationAllowed: false,
      reason: "not_fixture_source",
      status: "needs_human_review",
    });

    expect(
      draftCanonicalFixtureResponsibility({
        signal: FIXTURE_SHARED_SIGNAL,
        sourceDraft: {
          ...FIXTURE_SIGNAL_DRAFT,
          missingInfo: ["The confirmed date is missing."],
        },
      }),
    ).toMatchObject({
      consequentialMutationAllowed: false,
      reason: "source_incomplete",
      status: "needs_human_review",
    });

    expect(draftCanonicalFixtureResponsibility({ raw: "private" })).toMatchObject({
      consequentialMutationAllowed: false,
      reason: "source_incomplete",
      status: "needs_human_review",
    });
  });
});
