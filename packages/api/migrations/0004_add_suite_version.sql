-- What was actually run, recorded on the run it produced.
--
-- The dashboard's own version answers "how far along is this tool?" and lives
-- in package.json, where it is the same for every row. These two columns answer
-- a different question — "which suite produced this result?" — and that changes
-- per run, so it belongs on the row.
--
-- Both, rather than one:
--
--   suite_version  readable, and what someone quotes in a bug report
--   suite_sha      precise, and the only one that identifies a tree
--
-- The version alone would be misleading. It moves on release, and most runs
-- happen between releases, so a fortnight of runs would all claim the same
-- version while testing different code. The sha alone would be correct and
-- unreadable.
--
-- Nullable because they are: a run dispatched before this column existed has
-- none, a simulated run has no suite at all, and a real run whose callback
-- never arrived has nothing to record. A NOT NULL default would invent a
-- version for all three.

ALTER TABLE runs ADD COLUMN suite_version TEXT;
ALTER TABLE runs ADD COLUMN suite_sha TEXT;
