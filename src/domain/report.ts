import type {
  ResponsibilityReportProjection,
  ResponsibilityTaskProjection,
} from "../contracts.ts";

export function buildNeutralReport(
  tasks: readonly ResponsibilityTaskProjection[],
  periodLabel: string,
): ResponsibilityReportProjection {
  const included = tasks.filter((task) => task.status !== "needs_review");

  return {
    title: "本周家庭责任记录",
    periodLabel,
    tasks: included,
    excludedNeedsReviewCount: tasks.length - included.length,
  };
}
