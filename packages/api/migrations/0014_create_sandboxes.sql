-- A sandbox for each visitor (decision 52).
--
-- The dashboard stopped dispatching anything real. Every run started from it is
-- simulated, and every visitor gets a sandbox of their own: their runs, their
-- gate, their keys, their member list and their activity log. What they change
-- reaches nobody else, so every control can work — delete, lock down, revoke —
-- instead of being shown and refused.
--
-- `sandbox_id` NULL on a run means a real run, reported by a suite's own CI
-- through the webhook. Those are shown to every visitor and changed by none.
-- Older simulated rows have no sandbox either; `simulated = 1` keeps them out of
-- the real ones until retention removes them.
CREATE TABLE sandboxes (
  id          TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  lockdown    INTEGER NOT NULL DEFAULT 0 CHECK (lockdown IN (0, 1))
);
CREATE INDEX idx_sandboxes_created ON sandboxes (created_at);
CREATE INDEX idx_sandboxes_expires ON sandboxes (expires_at);

ALTER TABLE runs ADD COLUMN sandbox_id TEXT;
CREATE INDEX idx_runs_sandbox ON runs (sandbox_id, started_at DESC);

ALTER TABLE api_keys ADD COLUMN sandbox_id TEXT;
CREATE INDEX idx_api_keys_sandbox_id ON api_keys (sandbox_id);

-- The gate, one per sandbox. `run_gate` (0003) is left in place and unread: it
-- held the one real deployment's gate, and dropping it gains nothing.
CREATE TABLE sandbox_gate (
  sandbox_id  TEXT PRIMARY KEY,
  mode        TEXT NOT NULL DEFAULT 'open' CHECK (mode IN ('open', 'closed', 'window')),
  opens_at    TEXT,
  closes_at   TEXT,
  updated_at  TEXT,
  updated_by  TEXT
);

-- Who may sign in to a sandbox, and as what. `admin` here is the whitelist half
-- of becoming admin; the other half is the sandbox's admin key.
CREATE TABLE members (
  sandbox_id  TEXT NOT NULL,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('admin', 'qa', 'dev')),
  added_at    TEXT NOT NULL,
  added_by    TEXT NOT NULL,
  PRIMARY KEY (sandbox_id, email)
);

-- What happened in a sandbox, newest first. Never a key, a token or a body.
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sandbox_id  TEXT NOT NULL,
  at          TEXT NOT NULL,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  detail      TEXT
);
CREATE INDEX idx_audit_sandbox ON audit_log (sandbox_id, id DESC);
