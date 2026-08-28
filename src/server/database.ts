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
  `INSERT INTO demo_state VALUES (1, '2026-08-28T12:00:00.000Z')`,
  `INSERT INTO members VALUES
    ('member_primary', '林秀', 'primary', 'limited'),
    ('member_partner', '陈建国', 'partner', 'available'),
    ('member_subject', '周素兰', 'subject', 'available')`,
  `INSERT INTO evidence VALUES
    ('evidence_subject_private', 'member_subject', '2026-08-28T08:15:00.000Z', '腿又疼了，下楼有点吃力', '"self"', 0),
    ('evidence_health_deadline', 'member_primary', '2026-08-20T08:00:00.000Z', '医生说一个月以后复查，挂骨科', '"space"', 0),
    ('evidence_health_report', 'member_primary', '2026-08-21T09:00:00.000Z', '上次检查报告在客厅电视柜第二个抽屉', '"space"', 0),
    ('evidence_health_meal', 'member_subject', '2026-08-21T10:00:00.000Z', '复查不需要空腹，下午去更舒服', '"care_related"', 0),
    ('evidence_health_hospital', 'member_subject', '2026-08-21T11:00:00.000Z', '我只去市三院', '"care_related"', 0),
    ('evidence_school_form', 'member_primary', '2026-08-22T08:00:00.000Z', '新生体检表要在八月二十八日前交回', '"space"', 0),
    ('evidence_care_medicine', 'member_partner', '2026-08-22T09:00:00.000Z', '血压药一天两次，饭后吃', '"care_related"', 0),
    ('evidence_home_storage', 'member_primary', '2026-08-23T08:00:00.000Z', '换季衣服还没收', '"space"', 0),
    ('evidence_health_contact', 'member_primary', '2026-08-23T09:00:00.000Z', '市三院骨科联系人是李医生', '"care_related"', 0),
    ('evidence_discussion_house', 'member_partner', '2026-08-24T08:00:00.000Z', '明年是不是该考虑换个大点的房子', '"space"', 0),
    ('evidence_discussion_swim', 'member_primary', '2026-08-24T09:00:00.000Z', '听说隔壁孩子去学游泳了', '"space"', 0)`,
  `INSERT INTO signals VALUES
    ('signal_health_deadline', 'evidence_health_deadline', '骨科复查期限临近', 'confirmed'),
    ('signal_health_report', 'evidence_health_report', '上次报告位置已知', 'confirmed'),
    ('signal_health_meal', 'evidence_health_meal', '复查不需要空腹', 'confirmed'),
    ('signal_health_hospital', 'evidence_health_hospital', '就诊地点偏好市三院', 'confirmed'),
    ('signal_school_form', 'evidence_school_form', '体检表有明确截止日', 'confirmed'),
    ('signal_care_medicine', 'evidence_care_medicine', '血压药需要每日饭后提醒', 'confirmed'),
    ('signal_home_storage', 'evidence_home_storage', '换季衣物待收纳', 'confirmed'),
    ('signal_health_contact', 'evidence_health_contact', '骨科联系人已知', 'confirmed')`,
  `INSERT INTO domains VALUES
    ('domain_health', '奶奶的近期健康照护', 'member_primary', 'active', '预约市三院骨科下午号', '"care_related"'),
    ('domain_school', '孩子的开学准备', 'member_primary', 'active', '八月二十八日前交回体检表', '"space"'),
    ('domain_home', '家里的日常补给与收纳', 'member_primary', 'active', NULL, '"space"')`,
  `INSERT INTO tasks VALUES
    ('task_health_booking', 'domain_health', 'evidence_health_deadline', '挂市三院骨科复查号', 'open', 'member_primary', 'member_primary', 'member_primary', 'member_primary', 'member_primary', 'member_primary'),
    ('task_health_meal', 'domain_health', 'evidence_health_meal', '确认复查是否需要空腹', 'open', 'member_primary', 'member_primary', 'member_primary', 'member_primary', NULL, 'member_primary'),
    ('task_health_report', 'domain_health', 'evidence_health_report', '带上次检查报告', 'open', 'member_primary', 'member_primary', 'member_primary', 'member_primary', NULL, 'member_primary'),
    ('task_health_visit', 'domain_health', 'evidence_health_hospital', '陪诊当天到场', 'open', 'member_primary', 'member_primary', 'member_primary', 'member_primary', NULL, 'member_primary'),
    ('task_health_followup', 'domain_health', 'evidence_health_contact', '两周后复诊预约', 'open', 'member_primary', 'member_primary', 'member_primary', 'member_primary', NULL, 'member_primary'),
    ('task_school_form', 'domain_school', 'evidence_school_form', '交回新生体检表', 'open', 'member_primary', 'member_primary', 'member_primary', 'member_primary', 'member_primary', 'member_primary'),
    ('task_school_supplies', 'domain_school', 'evidence_school_form', '买齐校服与文具', 'open', 'member_primary', 'member_primary', 'member_primary', 'member_primary', NULL, 'member_primary'),
    ('task_home_storage', 'domain_home', 'evidence_home_storage', '收换季衣物', 'completed', NULL, 'member_primary', 'member_primary', 'member_primary', 'member_partner', 'member_primary')`,
  `INSERT INTO handovers VALUES
    ('handover_health', 'domain_health', 'member_primary', 'member_partner', 0, 0, 0, 'blocked', 0)`,
  `INSERT INTO care_rules VALUES
    ('care_rule_medicine', 'member_subject', 'draft', '每天 20:00 饭后', 60, '["member_partner","member_primary"]', 0)`,
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
