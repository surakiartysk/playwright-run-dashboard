-- Keys a visitor can mint for themselves, to try the API from a terminal.
--
-- The dashboard's demo sign-in is public on purpose, and the one thing it could
-- not offer was the part of the product that is not a page: POST /runs from a
-- script. A key needs an admin to issue it, so nobody trying the site could ever
-- hold one. A sandbox key is the demo role's own: it can only ever simulate (the
-- same guard as a demo session, decision 12), it dies after a day, and it is
-- rate limited.
--
-- `expires_at` is general — any key may carry one — and `sandbox` marks the ones
-- the dashboard issued to a visitor, so they can be kept out of the admin's list
-- of real credentials and swept up when they expire.
ALTER TABLE api_keys ADD COLUMN expires_at TEXT;
ALTER TABLE api_keys ADD COLUMN sandbox INTEGER NOT NULL DEFAULT 0 CHECK (sandbox IN (0, 1));

CREATE INDEX idx_api_keys_sandbox ON api_keys (sandbox, created_at);
