import { createHash } from "node:crypto";

import {
  RequestHashSchema,
  type RequestHash,
} from "../../../packages/contracts/src/index";

import { createResponsibilityError } from "./errors";

const canonicalJson = (value: unknown): string => {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  if (typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }

  throw createResponsibilityError("internal_failure");
};

export const hashResponsibilityRequest = (request: unknown): RequestHash =>
  RequestHashSchema.parse(
    createHash("sha256").update(canonicalJson(request)).digest("hex"),
  );
