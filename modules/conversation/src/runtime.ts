import { randomUUID } from "node:crypto";

import {
  EntityIdSchema,
  type EntityId,
} from "../../../packages/contracts/src/index";

export interface EntityIdGenerator {
  next(): EntityId;
}

export const RANDOM_ENTITY_ID_GENERATOR: EntityIdGenerator = Object.freeze({
  next: () => EntityIdSchema.parse(randomUUID()),
});

export const createSequenceEntityIdGenerator = (
  values: readonly string[],
): EntityIdGenerator => {
  const ids = values.map((value) => EntityIdSchema.parse(value));
  let index = 0;

  return Object.freeze({
    next: (): EntityId => {
      const id = ids[index];

      if (id === undefined) {
        throw new Error("The deterministic entity ID sequence is exhausted.");
      }

      index += 1;
      return id;
    },
  });
};
