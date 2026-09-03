-- The run gate — whether developers may start runs right now.
--
-- Single row, because there is one gate. The CHECK on the id is what enforces
-- that: without it a second row is a silent bug where the gate depends on
-- which row a query happens to return first.
--
-- Deliberately not a permission. Permissions live in the policy table and
-- answer "may this role ever do this"; the gate answers "is now a good time",
-- which is a coordination question with a different owner and a different
-- lifetime. Conflating them would mean revoking a role to quiet a release
-- window.

CREATE TABLE run_gate (
  id             INTEGER PRIMARY KEY CHECK (id = 1),

  -- 'open'/'closed' are a manual switch. 'window' is a one-off period, open
  -- between the two timestamps and closed either side of it.
  mode           TEXT NOT NULL DEFAULT 'open'
                 CHECK (mode IN ('open', 'closed', 'window')),

  -- ISO-8601 UTC. Only read in 'window' mode.
  opens_at       TEXT,
  closes_at      TEXT,

  -- Who last changed it, so "why can't I run anything?" has an answer.
  updated_at     TEXT,
  updated_by     TEXT
);

-- Open by default: a fresh database must not lock everyone out.
INSERT INTO run_gate (id, mode) VALUES (1, 'open');
