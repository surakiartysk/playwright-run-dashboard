-- Which suite a run belongs to.
--
-- Until now there was one suite, so "which one?" had a single answer and no
-- column was needed. A second suite makes the question real: a UI journey run
-- and an API contract run are different work, dispatched to different
-- repositories, and a history that cannot tell them apart cannot answer
-- "is the UI red, or is it just the API?" — which is the first thing anyone
-- asks when a bar goes red.
--
-- `service` could have carried this by convention (a `ui-` prefix, say). It
-- was rejected: a convention encoded in a free-form string is invisible to
-- SQL, so filtering, grouping and the trend chart would each have to re-derive
-- it by parsing, and every one of them could parse it differently. A column
-- that the database understands is filterable and groupable for free.
--
-- 'api' for every existing row, which is what they all were. NOT NULL with a
-- default rather than nullable: "unknown suite" is not a state this system can
-- be in — a run is dispatched to exactly one repository — and allowing NULL
-- would push a `?? 'api'` fallback into every reader.
ALTER TABLE runs ADD COLUMN suite TEXT NOT NULL DEFAULT 'api'
  CHECK (suite IN ('api', 'ui'));

-- The list view filters by suite, and the trend chart groups by it.
CREATE INDEX idx_runs_suite ON runs (suite, started_at DESC);
