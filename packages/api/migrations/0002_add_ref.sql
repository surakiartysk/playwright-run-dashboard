-- The git ref a run was made against.
--
-- Added as a second migration rather than folded into 0001, so the schema's
-- history records that `ref` arrived once the role model needed it.
--
-- Defaults to 'main' because every run that existed before this column did was
-- a main-branch run — the dashboard could not target anything else.

ALTER TABLE runs ADD COLUMN ref TEXT NOT NULL DEFAULT 'main';

-- `dev` only ever sees main-branch runs, so that filter runs on every list
-- request a `dev` makes.
CREATE INDEX idx_runs_ref ON runs (ref);
