import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS demo_state (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    now TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('primary', 'partner', 'subject')),
    capacity TEXT NOT NULL CHECK (capacity IN ('available', 'limited'))
  ) STRICT;

  CREATE TABLE IF NOT EXISTS evidence (
    id TEXT PRIMARY KEY,
    speaker_id TEXT NOT NULL REFERENCES members(id),
    occurred_at TEXT NOT NULL,
    text TEXT NOT NULL,
    visibility_json TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1))
  ) STRICT;

  CREATE TABLE IF NOT EXISTS signals (
    id TEXT PRIMARY KEY,
    evidence_id TEXT NOT NULL REFERENCES evidence(id),
    summary TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('observed', 'confirmed', 'dismissed', 'needs_review'))
  ) STRICT;

  CREATE TABLE IF NOT EXISTS domains (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_id TEXT REFERENCES members(id),
    status TEXT NOT NULL CHECK (status IN ('active', 'needs_review')),
    next_action TEXT,
    visibility_json TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    domain_id TEXT NOT NULL REFERENCES domains(id),
    evidence_id TEXT REFERENCES evidence(id),
    title TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open', 'completed', 'needs_review')),
    future_reminder_owner_id TEXT REFERENCES members(id),
    discovered_by TEXT REFERENCES members(id),
    deadline_kept_by TEXT REFERENCES members(id),
    scheduled_by TEXT REFERENCES members(id),
    executed_by TEXT REFERENCES members(id),
    followed_up_by TEXT REFERENCES members(id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS handovers (
    id TEXT PRIMARY KEY,
    domain_id TEXT NOT NULL REFERENCES domains(id),
    from_member_id TEXT NOT NULL REFERENCES members(id),
    to_member_id TEXT NOT NULL REFERENCES members(id),
    has_last_report INTEGER NOT NULL DEFAULT 0 CHECK (has_last_report IN (0, 1)),
    from_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (from_confirmed IN (0, 1)),
    to_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (to_confirmed IN (0, 1)),
    state TEXT NOT NULL CHECK (state IN ('blocked', 'awaiting_confirmations', 'accepted')),
    version INTEGER NOT NULL DEFAULT 0
  ) STRICT;

  CREATE TABLE IF NOT EXISTS care_rules (
    id TEXT PRIMARY KEY,
    subject_id TEXT NOT NULL REFERENCES members(id),
    state TEXT NOT NULL CHECK (state IN ('draft', 'active')),
    schedule_label TEXT NOT NULL,
    acknowledgement_timeout_seconds INTEGER NOT NULL CHECK (acknowledgement_timeout_seconds > 0),
    escalation_member_ids_json TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 0
  ) STRICT;

  CREATE TABLE IF NOT EXISTS care_events (
    id TEXT PRIMARY KEY,
    care_rule_id TEXT NOT NULL REFERENCES care_rules(id),
    state TEXT NOT NULL CHECK (state IN ('reminded', 'escalated', 'acknowledged', 'closed')),
    reminded_at TEXT NOT NULL,
    acknowledged_at TEXT,
    closed_at TEXT,
    escalation_index INTEGER NOT NULL DEFAULT 0
  ) STRICT;

  CREATE TABLE IF NOT EXISTS notification_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    logical_event_id TEXT NOT NULL,
    recipient_id TEXT NOT NULL REFERENCES members(id),
    channel TEXT NOT NULL CHECK (channel IN ('app', 'robot_a3')),
    priority TEXT NOT NULL CHECK (priority IN ('normal', 'high', 'urgent')),
    template_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'deduplicated', 'shown_in_app', 'disabled', 'sent_to_provider', 'failed')),
    safe_code TEXT,
    occurred_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS notification_dedupe_lookup
    ON notification_logs(logical_event_id, recipient_id, channel, occurred_at);

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id TEXT NOT NULL REFERENCES members(id),
    action TEXT NOT NULL,
    target_id TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    safe_metadata_json TEXT NOT NULL
  ) STRICT;
`;

const SEED_STATEMENTS = [
  `INSERT INTO demo_state VALUES (1, '2026-08-28T09:00:00.000Z')`,
  `INSERT INTO members VALUES
    ('member_primary', '林晓', 'primary', 'limited'),
    ('member_partner', '周然', 'partner', 'available'),
    ('member_subject', '奶奶', 'subject', 'available')`,
  `INSERT INTO evidence VALUES
    ('evidence_private_pain', 'member_subject', '2026-08-28T08:55:00.000Z', '腿又疼了', '"self"', 0),
    ('evidence_appointment', 'member_primary', '2026-08-25T09:00:00.000Z', '复查预约已确认', '"space"', 0),
    ('evidence_transport', 'member_partner', '2026-08-25T10:00:00.000Z', '周五可以接送', '"space"', 0),
    ('evidence_report', 'member_primary', '2026-08-26T09:00:00.000Z', '上次检查报告已整理', '"space"', 0),
    ('evidence_medicine', 'member_subject', '2026-08-26T12:00:00.000Z', '药盒已经补好', '"care_related"', 0),
    ('evidence_calendar', 'member_partner', '2026-08-26T13:00:00.000Z', '日历提醒已设置', '"space"', 0),
    ('evidence_followup', 'member_primary', '2026-08-27T09:00:00.000Z', '复查后会记录结果', '"space"', 0),
    ('evidence_grocery', 'member_partner', '2026-08-27T12:00:00.000Z', '本周采购完成', '"space"', 0),
    ('evidence_bill', 'member_primary', '2026-08-27T13:00:00.000Z', '水电账单已处理', '"space"', 0),
    ('evidence_chat', 'member_subject', '2026-08-27T14:00:00.000Z', '今天阳光很好', '"space"', 0),
    ('evidence_recipe', 'member_partner', '2026-08-27T15:00:00.000Z', '晚饭想做面条', '"space"', 0)`,
  `INSERT INTO signals VALUES
    ('signal_appointment', 'evidence_appointment', '复查预约已确认', 'confirmed'),
    ('signal_transport', 'evidence_transport', '复查接送已有安排', 'confirmed'),
    ('signal_report', 'evidence_report', '检查资料已经整理', 'confirmed'),
    ('signal_medicine', 'evidence_medicine', '日常用药准备完成', 'confirmed'),
    ('signal_calendar', 'evidence_calendar', '复查提醒已经设置', 'confirmed'),
    ('signal_followup', 'evidence_followup', '复查后续记录已有计划', 'confirmed'),
    ('signal_grocery', 'evidence_grocery', '本周家庭采购完成', 'confirmed'),
    ('signal_bill', 'evidence_bill', '本期家庭账单已处理', 'confirmed'),
    ('signal_chat', 'evidence_chat', '日常闲聊，不形成责任', 'dismissed'),
    ('signal_recipe', 'evidence_recipe', '餐食讨论，不形成责任', 'dismissed')`,
  `INSERT INTO domains VALUES
    ('domain_followup', '奶奶复查', 'member_primary', 'active', '带齐资料按时复查', '"space"'),
    ('domain_medicine', '日常用药', 'member_subject', 'active', '按已确认规则提醒', '"care_related"'),
    ('domain_household', '家庭事务', 'member_partner', 'active', '完成本周例行事项', '"space"')`,
  `INSERT INTO tasks VALUES
    ('task_followup', 'domain_followup', 'evidence_appointment', '完成本次复查', 'open', 'member_primary', 'member_subject', 'member_primary', 'member_partner', NULL, NULL),
    ('task_report', 'domain_followup', 'evidence_report', '整理检查资料', 'completed', NULL, 'member_primary', 'member_primary', 'member_primary', 'member_primary', 'member_partner'),
    ('task_medicine', 'domain_medicine', 'evidence_medicine', '准备日常药盒', 'completed', NULL, 'member_subject', 'member_subject', 'member_subject', 'member_subject', 'member_primary'),
    ('task_grocery', 'domain_household', 'evidence_grocery', '完成家庭采购', 'completed', NULL, 'member_partner', 'member_partner', 'member_partner', 'member_partner', 'member_primary'),
    ('task_bill', 'domain_household', 'evidence_bill', '处理家庭账单', 'completed', NULL, 'member_primary', 'member_primary', 'member_primary', 'member_primary', 'member_partner')`,
  `INSERT INTO handovers VALUES
    ('handover_followup', 'domain_followup', 'member_primary', 'member_partner', 0, 0, 0, 'blocked', 0)`,
  `INSERT INTO care_rules VALUES
    ('care_medicine', 'member_subject', 'draft', '每天晚饭后', 30, '["member_primary","member_partner"]', 0)`,
] as const;

export type DemoDatabase = DatabaseSync;

export function createDemoDatabase(path = ":memory:"): DemoDatabase {
  const database = new DatabaseSync(path);
  database.exec(SCHEMA);
  const state = database
    .prepare("SELECT COUNT(*) AS count FROM demo_state")
    .get() as { readonly count: number };
  if (state.count === 0) {
    resetDemoDatabase(database);
  }
  return database;
}

export function resetDemoDatabase(database: DemoDatabase): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      DELETE FROM audit_logs;
      DELETE FROM notification_logs;
      DELETE FROM care_events;
      DELETE FROM care_rules;
      DELETE FROM handovers;
      DELETE FROM tasks;
      DELETE FROM domains;
      DELETE FROM signals;
      DELETE FROM evidence;
      DELETE FROM members;
      DELETE FROM demo_state;
      DELETE FROM sqlite_sequence WHERE name = 'notification_logs' OR name = 'audit_logs';
    `);
    for (const statement of SEED_STATEMENTS) {
      database.exec(statement);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
