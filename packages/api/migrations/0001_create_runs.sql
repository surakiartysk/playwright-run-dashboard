-- One row per requested test run.
--
-- The id is human-readable on purpose: `20260826-1430-items` sorts
-- chronologically, is unique enough in practice, and doubles as the R2 prefix
-- for that run's report. A UUID would need a second column to answer "when was
-- this and what did it cover?", which is the question anyone scanning the table
-- is actually asking.

CREATE TABLE runs (
  id            TEXT PRIMARY KEY,

  -- What was asked for
  service       TEXT NOT NULL,
  tags          TEXT NOT NULL,
  workers       INTEGER,
  triggered_by  TEXT NOT NULL,

  -- Where it got to. `queued` is written before GitHub is called, so a run
  -- that fails to dispatch is still visible rather than silently absent.
  status        TEXT NOT NULL CHECK (
                  status IN ('queued', 'running', 'passed', 'failed', 'error', 'timeout')
                ),

  -- Results, null until the webhook lands
  total         INTEGER,
  passed        INTEGER,
  failed        INTEGER,

  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  duration_ms   INTEGER,

  -- R2 prefix holding the report, null until one is uploaded
  report_path   TEXT,

  -- Link back to the Actions run, so a failure that never reported can still
  -- be investigated
  workflow_url  TEXT
);

-- The list view is always "most recent first", and the status filter is the
-- only one the UI offers.
CREATE INDEX idx_runs_started_at ON runs (started_at DESC);
CREATE INDEX idx_runs_status ON runs (status);
