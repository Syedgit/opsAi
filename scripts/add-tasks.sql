-- Shift tasks, timed alerts and evidence (task_templates = what a store wants done, task_runs = each occurrence).
-- Safe to run more than once. Run in the Supabase SQL editor before deploying the matching code.

CREATE TABLE IF NOT EXISTS task_templates (
  id                      TEXT PRIMARY KEY,
  store_id                TEXT NOT NULL,
  title                   TEXT NOT NULL,
  instructions            TEXT,
  category                TEXT NOT NULL DEFAULT 'other',
  shift                   TEXT,
  start_time              TEXT NOT NULL,
  end_time                TEXT,
  repeat_every_minutes    INTEGER,
  days_of_week            INTEGER[] NOT NULL DEFAULT '{}',
  evidence                TEXT NOT NULL DEFAULT 'either',
  points                  INTEGER NOT NULL DEFAULT 1,
  remind_every_minutes    INTEGER NOT NULL DEFAULT 15,
  escalate_after_minutes  INTEGER DEFAULT 60,
  late_after_minutes      INTEGER NOT NULL DEFAULT 60,
  active                  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS task_templates_store_id_active_idx ON task_templates (store_id, active);

CREATE TABLE IF NOT EXISTS task_runs (
  id                   TEXT PRIMARY KEY,
  template_id          TEXT NOT NULL,
  store_id             TEXT NOT NULL,
  title                TEXT NOT NULL,
  category             TEXT NOT NULL,
  evidence             TEXT NOT NULL,
  points               INTEGER NOT NULL,
  late_after_minutes   INTEGER NOT NULL DEFAULT 60,
  due_at               TIMESTAMP(3) NOT NULL,
  local_date           TEXT NOT NULL,
  code                 INTEGER NOT NULL,
  status               TEXT NOT NULL DEFAULT 'OPEN',
  alerted_at           TIMESTAMP(3),
  last_reminder_at     TIMESTAMP(3),
  reminder_count       INTEGER NOT NULL DEFAULT 0,
  escalated_at         TIMESTAMP(3),
  completed_at         TIMESTAMP(3),
  completed_by_phone   TEXT,
  evidence_type        TEXT,
  evidence_text        TEXT,
  evidence_media_id    TEXT,
  evidence_message_id  TEXT,
  created_at           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- The same task can never be created twice for the same due time, even if two cron runs overlap.
CREATE UNIQUE INDEX IF NOT EXISTS task_runs_template_id_due_at_key ON task_runs (template_id, due_at);
CREATE INDEX IF NOT EXISTS task_runs_store_id_local_date_idx ON task_runs (store_id, local_date);
CREATE INDEX IF NOT EXISTS task_runs_store_id_status_idx ON task_runs (store_id, status);

-- 7-Eleven inspection support (standard IDs, criticality, answer limits, outcomes).
-- ADD COLUMN IF NOT EXISTS, so this is safe whether or not the tables were created by an earlier version of this file.
ALTER TABLE task_templates ADD COLUMN IF NOT EXISTS standard_id TEXT;
ALTER TABLE task_templates ADD COLUMN IF NOT EXISTS criticality TEXT;
ALTER TABLE task_templates ADD COLUMN IF NOT EXISTS min_value DOUBLE PRECISION;
ALTER TABLE task_templates ADD COLUMN IF NOT EXISTS max_value DOUBLE PRECISION;
ALTER TABLE task_templates ADD COLUMN IF NOT EXISTS unit TEXT;
ALTER TABLE task_templates ADD COLUMN IF NOT EXISTS fallback TEXT;

ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS standard_id TEXT;
ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS criticality TEXT;
ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS min_value DOUBLE PRECISION;
ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS max_value DOUBLE PRECISION;
ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS unit TEXT;
ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS fallback TEXT;
ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS outcome TEXT;
ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS result_value DOUBLE PRECISION;
ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS issue_text TEXT;

-- Imported inspector reports (7Clean Debrief Report): result and failed standards only.
CREATE TABLE IF NOT EXISTS inspection_reports (
  id            TEXT PRIMARY KEY,
  store_id      TEXT NOT NULL,
  inspected_on  TIMESTAMP(3) NOT NULL,
  cycle         INTEGER,
  visit         INTEGER,
  percent       DOUBLE PRECISION NOT NULL,
  earned        INTEGER,
  possible      INTEGER,
  property      TEXT,
  categories    JSONB NOT NULL,
  findings      JSONB NOT NULL,
  created_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS inspection_reports_store_id_inspected_on_percent_key ON inspection_reports (store_id, inspected_on, percent);
CREATE INDEX IF NOT EXISTS inspection_reports_store_id_inspected_on_idx ON inspection_reports (store_id, inspected_on);

-- How often a task comes round (weekly weekdays / every N days / monthly) and AI photo checks.
ALTER TABLE task_templates ADD COLUMN IF NOT EXISTS frequency TEXT NOT NULL DEFAULT 'weekly';
ALTER TABLE task_templates ADD COLUMN IF NOT EXISTS interval_days INTEGER;
ALTER TABLE task_templates ADD COLUMN IF NOT EXISTS month_days INTEGER[] NOT NULL DEFAULT '{}';
ALTER TABLE task_templates ADD COLUMN IF NOT EXISTS anchor_date TEXT;
ALTER TABLE task_templates ADD COLUMN IF NOT EXISTS photo_check TEXT;

ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS photo_check TEXT;
ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS photo_verdict TEXT;
ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS photo_note TEXT;
ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS photo_misses INTEGER NOT NULL DEFAULT 0;

-- Store setup (type, hours, shifts, fuel pumps), saved by the setup wizard.
ALTER TABLE store_config ADD COLUMN IF NOT EXISTS setup_json JSONB;
