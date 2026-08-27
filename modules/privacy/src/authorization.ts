import type {
  Evidence,
  Member,
  MemberActor,
  Task,
  Visibility,
} from "../../../packages/contracts/src/index";

export const actorMatchesActiveMember = (
  actor: MemberActor,
  member: Member,
): boolean =>
  member.id === actor.memberId &&
  member.spaceId === actor.spaceId &&
  member.role === actor.role &&
  member.status === "active";

export const canReadVisibility = (
  actor: MemberActor,
  visibility: Visibility,
): boolean => {
  switch (visibility.kind) {
    case "self":
      return visibility.memberId === actor.memberId;
    case "space":
      return true;
    case "members":
      return visibility.memberIds.includes(actor.memberId);
    case "care_related":
      return (
        visibility.subjectId === actor.memberId ||
        visibility.memberIds.includes(actor.memberId)
      );
  }
};

export const isTaskReportEligible = (
  task: Task,
  evidenceById: ReadonlyMap<string, Evidence>,
): boolean =>
  task.reviewState === "current" &&
  task.evidenceIds.every(
    (evidenceId) => evidenceById.get(evidenceId)?.state === "available",
  );

export const filterReportEligibleTasks = (
  tasks: readonly Task[],
  evidence: readonly Evidence[],
): readonly Task[] => {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));

  return tasks.filter((task) => isTaskReportEligible(task, evidenceById));
};
