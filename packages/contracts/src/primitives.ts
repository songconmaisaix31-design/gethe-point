import { z } from "zod";

export const EntityIdSchema = z.uuid();
export type EntityId = z.infer<typeof EntityIdSchema>;

export const RequestIdSchema = z.uuid();
export type RequestId = z.infer<typeof RequestIdSchema>;

export const CorrelationIdSchema = z.uuid();
export type CorrelationId = z.infer<typeof CorrelationIdSchema>;

export const TimestampSchema = z.iso.datetime({ offset: true });
export type Timestamp = z.infer<typeof TimestampSchema>;

export const DateSchema = z.iso.date();
export type DateString = z.infer<typeof DateSchema>;

export const TimeOfDaySchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Expected HH:mm in 24-hour time");
export type TimeOfDay = z.infer<typeof TimeOfDaySchema>;

export const RecordVersionSchema = z.number().int().nonnegative();
export type RecordVersion = z.infer<typeof RecordVersionSchema>;

export const IdempotencyKeySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;

export const RequestHashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Expected a lowercase SHA-256 digest");
export type RequestHash = z.infer<typeof RequestHashSchema>;

export const ShortTextSchema = z.string().trim().min(1).max(160);
export const DetailTextSchema = z.string().trim().min(1).max(2_000);
export const PrivateContentSchema = z.string().trim().min(1).max(4_000);
export const RedactedExcerptSchema = z.string().trim().min(1).max(280);
export const SafeErrorMessageSchema = z.string().trim().min(1).max(200);

export const PageRequestSchema = z.strictObject({
  cursor: z.string().min(1).max(512).nullable(),
  limit: z.number().int().min(1).max(100),
});
export type PageRequest = z.infer<typeof PageRequestSchema>;

export const PageInfoSchema = z.strictObject({
  nextCursor: z.string().min(1).max(512).nullable(),
  hasMore: z.boolean(),
});
export type PageInfo = z.infer<typeof PageInfoSchema>;

export const TimeRangeSchema = z
  .strictObject({
    startAt: TimestampSchema,
    endAt: TimestampSchema,
  })
  .refine(({ endAt, startAt }) => Date.parse(endAt) > Date.parse(startAt), {
    message: "endAt must be later than startAt",
    path: ["endAt"],
  });
export type TimeRange = z.infer<typeof TimeRangeSchema>;

export const RecordMetadataSchema = z.strictObject({
  id: EntityIdSchema,
  spaceId: EntityIdSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  version: RecordVersionSchema,
});
export type RecordMetadata = z.infer<typeof RecordMetadataSchema>;

export const TargetReferenceSchema = z.strictObject({
  type: z.enum([
    "space",
    "member",
    "conversation",
    "message",
    "evidence",
    "signal",
    "domain",
    "task",
    "handover",
    "care_rule",
    "care_event",
    "consent",
    "export",
  ]),
  id: EntityIdSchema,
});
export type TargetReference = z.infer<typeof TargetReferenceSchema>;
