import type { Role } from "../contracts.ts";

export interface Clock {
  now(): Date;
}

export interface FixtureSession {
  readonly role: Role;
}
