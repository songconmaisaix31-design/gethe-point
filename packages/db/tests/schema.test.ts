import { readFile } from "node:fs/promises";

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { databaseSchema, tasks } from "../src/schema";

const migrationPath = new URL("../migrations/0000_initial.sql", import.meta.url);

describe("database schema", () => {
  it("exports every required persistence aggregate", () => {
    expect(Object.keys(databaseSchema).sort()).toEqual([
      "auditLogs",
      "careEvents",
      "careRules",
      "consentDecisions",
      "conversationMembers",
      "conversations",
      "domainEvidence",
      "domains",
      "evidence",
      "handovers",
      "idempotencyRecords",
      "members",
      "messages",
      "reminders",
      "signalDraftEvidence",
      "signalDrafts",
      "signalEvidence",
      "signals",
      "spaces",
      "taskEvidence",
      "tasks",
    ]);
  });

  it("persists all five responsibility columns", () => {
    const columnNames = getTableConfig(tasks).columns.map(({ name }) => name);

    expect(columnNames).toEqual(
      expect.arrayContaining([
        "discovered_by",
        "deadline_kept_by",
        "scheduled_by",
        "executed_by",
        "followed_up_by",
      ]),
    );
  });

  it("keeps credentials out of the migration", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).not.toMatch(/POSTGRES_PASSWORD\s*=/u);
    expect(migration).not.toMatch(/postgres(?:ql)?:\/\/[^\s]+:[^\s]+@/u);
  });
});
