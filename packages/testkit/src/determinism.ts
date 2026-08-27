import { createHash } from "node:crypto";

import {
  EntityIdSchema,
  TimestampSchema,
  type Clock,
  type EntityId,
  type Timestamp,
} from "../../contracts/src/index";

export const DEFAULT_FIXTURE_INSTANT = "2026-08-27T00:00:00.000Z";
export const DEFAULT_ID_NAMESPACE = "we-remember-golden-household-v1";

export interface StableIdFactory {
  forKey(key: string): EntityId;
}

export const createFixedClock = (instant: string | Date): Clock => {
  const epochMs = new Date(instant).getTime();

  if (!Number.isFinite(epochMs)) {
    throw new RangeError("Fixture clock requires a valid instant.");
  }

  return Object.freeze({
    now: () => new Date(epochMs),
  });
};

export const timestampAt = (clock: Clock, offsetSeconds = 0): Timestamp =>
  TimestampSchema.parse(
    new Date(clock.now().getTime() + offsetSeconds * 1_000).toISOString(),
  );

export const createStableIdFactory = (
  namespace = DEFAULT_ID_NAMESPACE,
): StableIdFactory => {
  if (namespace.trim().length === 0) {
    throw new RangeError("Fixture ID namespace must not be empty.");
  }

  return Object.freeze({
    forKey: (key: string) => {
      if (key.trim().length === 0) {
        throw new RangeError("Fixture ID key must not be empty.");
      }

      const digest = createHash("sha256")
        .update(`${namespace}:${key}`, "utf8")
        .digest("hex");
      const uuid = [
        digest.slice(0, 8),
        digest.slice(8, 12),
        `4${digest.slice(13, 16)}`,
        `8${digest.slice(17, 20)}`,
        digest.slice(20, 32),
      ].join("-");

      return EntityIdSchema.parse(uuid);
    },
  });
};
