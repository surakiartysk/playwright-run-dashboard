-- Whether a run was simulated rather than dispatched to a real workflow.
--
-- The dashboard showed a simulated run exactly like a real one: "13 / 13",
-- a report link, a duration. `demo` always simulates, and so does a whole
-- deployment that leaves SIMULATE_DISPATCH on, so the runs most visitors see
-- were the ones that never ran — and nothing on the page said so. The POST
-- response carried `simulated: true`, but a response is gone the moment it
-- is read; the list is what people look at.
--
-- Decided once, by `simulates()` in github.ts, which dispatchWorkflow calls
-- too, so a row cannot say one thing while the dispatch did another.
ALTER TABLE runs ADD COLUMN simulated INTEGER NOT NULL DEFAULT 0
  CHECK (simulated IN (0, 1));

-- Runs from before this column. `demo` never dispatched anything, and every
-- simulated run that finished points at the shared sample report. What this
-- cannot recover: a run simulated by the deployment flag that never finished
-- — queued, running or errored — stays marked real. There is no other trace
-- of how it was dispatched.
UPDATE runs SET simulated = 1
 WHERE triggered_by = 'demo' OR report_path LIKE 'demo-report/%';
