import { z } from "zod";

import { EntityIdSchema } from "./primitives";

export const MemberRoleSchema = z.enum(["primary", "partner", "subject"]);
export type MemberRole = z.infer<typeof MemberRoleSchema>;

export const AuthenticationEvidenceSchema = z.enum([
  "fixture_demo",
  "verified_session",
]);
export type AuthenticationEvidence = z.infer<
  typeof AuthenticationEvidenceSchema
>;

export const MemberActorSchema = z.strictObject({
  kind: z.literal("member"),
  memberId: EntityIdSchema,
  spaceId: EntityIdSchema,
  role: MemberRoleSchema,
  authentication: AuthenticationEvidenceSchema,
});
export type MemberActor = z.infer<typeof MemberActorSchema>;

export const SystemServiceSchema = z.enum([
  "handover_service",
  "handover_expiry_service",
  "care_scheduler",
  "privacy_service",
]);
export type SystemService = z.infer<typeof SystemServiceSchema>;

export const SystemActorSchema = z.strictObject({
  kind: z.literal("system"),
  service: SystemServiceSchema,
  spaceId: EntityIdSchema,
  authentication: z.literal("internal_service"),
});
export type SystemActor = z.infer<typeof SystemActorSchema>;

export const ActorSchema = z.discriminatedUnion("kind", [
  MemberActorSchema,
  SystemActorSchema,
]);
export type Actor = z.infer<typeof ActorSchema>;

export const MemberActorRefSchema = MemberActorSchema.pick({
  kind: true,
  memberId: true,
  spaceId: true,
  role: true,
});

export const SystemActorRefSchema = SystemActorSchema.pick({
  kind: true,
  service: true,
  spaceId: true,
});

export const ActorRefSchema = z.discriminatedUnion("kind", [
  MemberActorRefSchema,
  SystemActorRefSchema,
]);
export type ActorRef = z.infer<typeof ActorRefSchema>;

export const HandoverServiceActorSchema = SystemActorSchema.extend({
  service: z.literal("handover_service"),
});
export type HandoverServiceActor = z.infer<
  typeof HandoverServiceActorSchema
>;

export const HandoverExpiryActorSchema = SystemActorSchema.extend({
  service: z.literal("handover_expiry_service"),
});
export type HandoverExpiryActor = z.infer<typeof HandoverExpiryActorSchema>;

export const CareSchedulerActorSchema = SystemActorSchema.extend({
  service: z.literal("care_scheduler"),
});
export type CareSchedulerActor = z.infer<typeof CareSchedulerActorSchema>;
