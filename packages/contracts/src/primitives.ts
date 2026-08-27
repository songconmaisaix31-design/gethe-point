import { z } from "zod";

export const EntityIdSchema = z.uuid();
export type EntityId = z.infer<typeof EntityIdSchema>;

export const RequestIdSchema = z.uuid();
export type RequestId = z.infer<typeof RequestIdSchema>;

export const CorrelationIdSchema = z.uuid();
export type CorrelationId = z.infer<typeof CorrelationIdSchema>;

export const TimestampSchema = z.iso.datetime({ offset: true });
export type Timestamp = z.infer<typeof TimestampSchema>;

const DAYS_BEFORE_MONTH = [
  0,
  31,
  59,
  90,
  120,
  151,
  181,
  212,
  243,
  273,
  304,
  334,
] as const;

interface ComparableTimestamp {
  readonly wholeSecond: number;
  readonly fraction: string;
}

const isLeapYear = (year: number): boolean =>
  year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

const leapYearsBefore = (year: number): number =>
  Math.floor((year + 3) / 4) -
  Math.floor((year + 99) / 100) +
  Math.floor((year + 399) / 400);

const getDaysBeforeMonth = (month: number): number => {
  const days = DAYS_BEFORE_MONTH[month - 1];
  if (days === undefined) {
    throw new RangeError("Timestamp month must be validated before comparison");
  }
  return days;
};

const toComparableTimestamp = (timestamp: Timestamp): ComparableTimestamp => {
  const year = Number(timestamp.slice(0, 4));
  const month = Number(timestamp.slice(5, 7));
  const day = Number(timestamp.slice(8, 10));
  const hour = Number(timestamp.slice(11, 13));
  const minute = Number(timestamp.slice(14, 16));
  const hasZuluOffset = timestamp.endsWith("Z");
  const offsetStart = hasZuluOffset ? timestamp.length - 1 : timestamp.length - 6;
  const second = offsetStart > 16 ? Number(timestamp.slice(17, 19)) : 0;
  const fraction = offsetStart > 19 ? timestamp.slice(20, offsetStart) : "";
  const offsetMinutes = hasZuluOffset
    ? 0
    : (timestamp[offsetStart] === "+" ? 1 : -1) *
      (Number(timestamp.slice(offsetStart + 1, offsetStart + 3)) * 60 +
        Number(timestamp.slice(offsetStart + 4, offsetStart + 6)));
  const calendarDay =
    year * 365 +
    leapYearsBefore(year) +
    getDaysBeforeMonth(month) +
    (month > 2 && isLeapYear(year) ? 1 : 0) +
    day -
    1;
  const wholeSecond =
    (((calendarDay * 24 + hour) * 60 + minute - offsetMinutes) * 60 +
      second);

  return { wholeSecond, fraction };
};

const compareFractionDigits = (left: string, right: string): -1 | 0 | 1 => {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftDigit = index < left.length ? left.charCodeAt(index) : 48;
    const rightDigit = index < right.length ? right.charCodeAt(index) : 48;
    if (leftDigit < rightDigit) {
      return -1;
    }
    if (leftDigit > rightDigit) {
      return 1;
    }
  }
  return 0;
};

/**
 * Orders two offset-aware instants after both inputs have passed TimestampSchema.
 *
 * This function's precondition is that `left` and `right` were already accepted
 * by `TimestampSchema`; unvalidated strings are outside its contract.
 *
 * @returns `-1` when `left` is earlier, `0` for the same instant, or `1` when
 * `left` is later.
 */
export const compareTimestamps = (
  left: Timestamp,
  right: Timestamp,
): -1 | 0 | 1 => {
  const leftTimestamp = toComparableTimestamp(left);
  const rightTimestamp = toComparableTimestamp(right);

  if (leftTimestamp.wholeSecond < rightTimestamp.wholeSecond) {
    return -1;
  }
  if (leftTimestamp.wholeSecond > rightTimestamp.wholeSecond) {
    return 1;
  }
  return compareFractionDigits(leftTimestamp.fraction, rightTimestamp.fraction);
};

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
  .refine(({ endAt, startAt }) => compareTimestamps(endAt, startAt) === 1, {
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
