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
  readonly wholeSecond: bigint;
  readonly fraction: string;
}

const isLeapYear = (year: bigint): boolean =>
  year % 4n === 0n && (year % 100n !== 0n || year % 400n === 0n);

const leapYearsBefore = (year: bigint): bigint =>
  (year + 3n) / 4n - (year + 99n) / 100n + (year + 399n) / 400n;

const getDaysBeforeMonth = (month: number): bigint => {
  const days = DAYS_BEFORE_MONTH[month - 1];
  if (days === undefined) {
    throw new RangeError("Timestamp month must be validated before comparison");
  }
  return BigInt(days);
};

const toComparableTimestamp = (timestamp: Timestamp): ComparableTimestamp => {
  const year = BigInt(timestamp.slice(0, 4));
  const month = Number(timestamp.slice(5, 7));
  const day = BigInt(timestamp.slice(8, 10));
  const hour = BigInt(timestamp.slice(11, 13));
  const minute = BigInt(timestamp.slice(14, 16));
  const hasZuluOffset = timestamp.endsWith("Z");
  const offsetStart = hasZuluOffset ? timestamp.length - 1 : timestamp.length - 6;
  const second = offsetStart > 16 ? BigInt(timestamp.slice(17, 19)) : 0n;
  const fraction = offsetStart > 19 ? timestamp.slice(20, offsetStart) : "";
  const offsetMinutes = hasZuluOffset
    ? 0n
    : (timestamp[offsetStart] === "+" ? 1n : -1n) *
      (BigInt(timestamp.slice(offsetStart + 1, offsetStart + 3)) * 60n +
        BigInt(timestamp.slice(offsetStart + 4, offsetStart + 6)));
  const calendarDay =
    year * 365n +
    leapYearsBefore(year) +
    getDaysBeforeMonth(month) +
    (month > 2 && isLeapYear(year) ? 1n : 0n) +
    day -
    1n;
  const wholeSecond =
    ((calendarDay * 24n + hour) * 60n + minute - offsetMinutes) * 60n +
    second;

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
 * The validated timestamp strings are converted with exact integer calendar and
 * offset arithmetic. Fractional digits are compared in place, so no precision
 * is discarded and equivalent trailing zeros remain equal.
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
