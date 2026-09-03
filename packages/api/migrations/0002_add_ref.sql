-- The git ref a run was made against.
--
-- Added as a second migration rather than folded into 0001 so the history
-- shows what it always shows in practice: the role model arrived after the
-- happy path worked, and it needed a column the first schema had no reason to
-- include.
--
-- Defaults to 'main' because every run that existed before this column did was
-- a main-branch run — the dashboard could not target anything else.

ALTER TABLE runs ADD COLUMN ref TEXT NOT NULL DEFAULT 'main';

-- `dev` only ever sees main-branch runs, so that filter runs on every list
-- request for a third of users.
CREATE INDEX idx_runs_ref ON runs (ref);
