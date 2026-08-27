import {
  FIXTURE_DOMAIN,
  FIXTURE_IDS,
  FIXTURE_SHARED_SIGNAL,
  FIXTURE_SIGNAL_DRAFT,
  FIXTURE_TASK,
} from "../../../packages/contracts/src/index";

import {
  ReadyResponsibilityDraftSchema,
  ResponsibilityDraftInputSchema,
  ResponsibilityDraftReviewSchema,
  type ResponsibilityDraftResult,
} from "../../responsibility/src/index";
import type { ResponsibilityDraftPort } from "../../responsibility/src/ports";

const sameValue = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

export const draftCanonicalFixtureResponsibility = (
  input: unknown,
): ResponsibilityDraftResult => {
  const parsed = ResponsibilityDraftInputSchema.safeParse(input);

  if (!parsed.success) {
    return ResponsibilityDraftReviewSchema.parse({
      consequentialMutationAllowed: false,
      reason: "source_incomplete",
      status: "needs_human_review",
    });
  }

  const { signal, sourceDraft } = parsed.data;

  if (sourceDraft.source !== "fixture") {
    return ResponsibilityDraftReviewSchema.parse({
      consequentialMutationAllowed: false,
      reason: "not_fixture_source",
      status: "needs_human_review",
    });
  }

  if (
    sourceDraft.kind !== "potential_task" ||
    sourceDraft.missingInfo.length > 0
  ) {
    return ResponsibilityDraftReviewSchema.parse({
      consequentialMutationAllowed: false,
      reason: "source_incomplete",
      status: "needs_human_review",
    });
  }

  if (
    signal.id !== FIXTURE_IDS.signal ||
    sourceDraft.id !== FIXTURE_IDS.signalDraft ||
    !sameValue(signal, FIXTURE_SHARED_SIGNAL) ||
    !sameValue(sourceDraft, FIXTURE_SIGNAL_DRAFT)
  ) {
    return ResponsibilityDraftReviewSchema.parse({
      consequentialMutationAllowed: false,
      reason: "unsupported_fixture",
      status: "needs_human_review",
    });
  }

  return ReadyResponsibilityDraftSchema.parse({
    consequentialMutationAllowed: false,
    domain: FIXTURE_DOMAIN,
    source: "fixture",
    status: "ready",
    task: FIXTURE_TASK,
  });
};

export const createCanonicalFixtureResponsibilityDraftPort =
  (): ResponsibilityDraftPort => ({
    draft: (input) => Promise.resolve(draftCanonicalFixtureResponsibility(input)),
  });

export const createFixtureResponsibilityDraftPort =
  createCanonicalFixtureResponsibilityDraftPort;
