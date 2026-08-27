import { createHash } from "node:crypto";

import {
  EntityIdSchema,
  RequestHashSchema,
  TimestampSchema,
  type ActiveCareRule,
  type Clock,
  type RequestHash,
  type Timestamp,
} from "../../../packages/contracts/src/index";
import { throwCareOperationError } from "./repository";

const canonicalize = (value: unknown): string => {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return throwCareOperationError("invalid_request");
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(
        ([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`,
      )
      .join(",")}}`;
  }

  return throwCareOperationError("invalid_request");
};

export const requestHash = (request: object): RequestHash => {
  const businessEntries = Object.entries(request).filter(
    ([key]) => key !== "idempotencyKey" && key !== "requestId",
  );
  const digest = createHash("sha256")
    .update(canonicalize(Object.fromEntries(businessEntries)))
    .digest("hex");
  return RequestHashSchema.parse(digest);
};

export const deterministicUuid = (namespace: string): string => {
  const digest = createHash("sha256").update(namespace).digest("hex");
  const variantNibble = (
    (Number.parseInt(digest.slice(16, 17), 16) & 0x3) |
    0x8
  ).toString(16);
  return EntityIdSchema.parse(
    `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(
      13,
      16,
    )}-${variantNibble}${digest.slice(17, 20)}-${digest.slice(20, 32)}`,
  );
};

export const timestampMillis = (timestamp: Timestamp): number => {
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds)) {
    return throwCareOperationError("invalid_request");
  }
  return milliseconds;
};

export const clockReading = (
  clock: Clock,
): Readonly<{ milliseconds: number; timestamp: Timestamp }> => {
  const reading = clock.now();
  const milliseconds = reading.getTime();
  if (!Number.isFinite(milliseconds)) {
    return throwCareOperationError("internal_failure");
  }
  return {
    milliseconds,
    timestamp: TimestampSchema.parse(reading.toISOString()),
  };
};

export const timestampAfterSeconds = (
  timestamp: Timestamp,
  seconds: number,
): Timestamp =>
  TimestampSchema.parse(
    new Date(timestampMillis(timestamp) + seconds * 1_000).toISOString(),
  );

export const assertNotFuture = (
  timestamp: Timestamp,
  clockMilliseconds: number,
): void => {
  if (timestampMillis(timestamp) > clockMilliseconds) {
    throwCareOperationError("invalid_request");
  }
};

interface LocalDate {
  readonly day: number;
  readonly month: number;
  readonly year: number;
}

interface LocalDateTime extends LocalDate {
  readonly hour: number;
  readonly minute: number;
}

const zonedFormatter = (timeZone: string): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat("en-CA-u-nu-latn", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  });

const zonedParts = (instant: Date, timeZone: string): LocalDateTime => {
  const parts = Object.fromEntries(
    zonedFormatter(timeZone)
      .formatToParts(instant)
      .filter(({ type }) =>
        ["day", "hour", "minute", "month", "year"].includes(type),
      )
      .map(({ type, value }) => [type, Number.parseInt(value, 10)]),
  );
  const { day, hour, minute, month, year } = parts;
  if (
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    month === undefined ||
    year === undefined
  ) {
    return throwCareOperationError("invalid_request");
  }
  return { day, hour, minute, month, year };
};

export const isSupportedTimeZone = (timeZone: string): boolean => {
  try {
    zonedFormatter(timeZone).format(new Date(0));
    return true;
  } catch {
    return false;
  }
};

const addLocalDays = (date: LocalDate, days: number): LocalDate => {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    day: shifted.getUTCDate(),
    month: shifted.getUTCMonth() + 1,
    year: shifted.getUTCFullYear(),
  };
};

const sameLocalDateTime = (
  left: LocalDateTime,
  right: LocalDateTime,
): boolean =>
  left.day === right.day &&
  left.hour === right.hour &&
  left.minute === right.minute &&
  left.month === right.month &&
  left.year === right.year;

const localDateTimeToTimestamp = (
  local: LocalDateTime,
  timeZone: string,
): Timestamp | null => {
  const targetAsUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
  );
  let candidate = targetAsUtc;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const represented = zonedParts(new Date(candidate), timeZone);
    const representedAsUtc = Date.UTC(
      represented.year,
      represented.month - 1,
      represented.day,
      represented.hour,
      represented.minute,
    );
    const correction = targetAsUtc - representedAsUtc;
    candidate += correction;
    if (correction === 0) {
      break;
    }
  }

  if (!sameLocalDateTime(zonedParts(new Date(candidate), timeZone), local)) {
    return null;
  }
  return TimestampSchema.parse(new Date(candidate).toISOString());
};

const parseTimeOfDay = (
  time: string,
): Readonly<{ hour: number; minute: number }> => {
  const [hourText, minuteText] = time.split(":");
  if (hourText === undefined || minuteText === undefined) {
    return throwCareOperationError("invalid_request");
  }
  return {
    hour: Number.parseInt(hourText, 10),
    minute: Number.parseInt(minuteText, 10),
  };
};

export const scheduleOccurrencesForTick = (
  rule: ActiveCareRule,
  observedAt: Timestamp,
): readonly Timestamp[] => {
  const confirmedAtMilliseconds = timestampMillis(rule.confirmedAt);
  const observedAtMilliseconds = timestampMillis(observedAt);

  if (rule.schedule.kind === "one_time") {
    return timestampMillis(rule.schedule.at) >= confirmedAtMilliseconds
      ? [rule.schedule.at]
      : [];
  }

  if (!isSupportedTimeZone(rule.schedule.timezone)) {
    return [];
  }

  const observedLocal = zonedParts(
    new Date(observedAtMilliseconds),
    rule.schedule.timezone,
  );
  const candidates = new Map<number, Timestamp>();

  for (const dayOffset of [-1, 0, 1]) {
    const localDate = addLocalDays(observedLocal, dayOffset);
    for (const time of rule.schedule.times) {
      const parsedTime = parseTimeOfDay(time);
      const timestamp = localDateTimeToTimestamp(
        { ...localDate, ...parsedTime },
        rule.schedule.timezone,
      );
      if (timestamp === null) {
        continue;
      }
      const milliseconds = timestampMillis(timestamp);
      if (milliseconds >= confirmedAtMilliseconds) {
        candidates.set(milliseconds, timestamp);
      }
    }
  }

  const ordered = [...candidates.entries()].sort(
    ([left], [right]) => left - right,
  );
  const latestDue = ordered.filter(
    ([milliseconds]) => milliseconds <= observedAtMilliseconds,
  ).at(-1);
  const next = ordered.find(
    ([milliseconds]) => milliseconds > observedAtMilliseconds,
  );

  return [latestDue?.[1], next?.[1]].filter(
    (timestamp): timestamp is Timestamp => timestamp !== undefined,
  );
};

export const careOccurrenceKey = (
  careRuleId: string,
  scheduledFor: Timestamp,
): string => `${careRuleId}:${scheduledFor}`;
