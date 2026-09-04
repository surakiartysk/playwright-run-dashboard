-- Credentials for machines, issued by this dashboard rather than by GitHub.
--
-- The alternative was handing a pipeline a GitHub PAT, which needs
-- `actions: write` on the whole repository — it can start any workflow against
-- any ref, and GitHub has no scope meaning "smoke, against main, four workers".
-- That rule already exists in policy.ts; a PAT routes around it. See decision 15.

CREATE TABLE api_keys (
  -- The public half, carried in the key itself so a lookup is one indexed read
  -- rather than a scan hashing every row.
  id            TEXT PRIMARY KEY,

  -- HMAC of the secret half. The secret is shown once at creation and is
  -- unrecoverable after — the same reason passwords are not stored either.
  hash          TEXT NOT NULL,

  -- What this key is for, in words: 'checkout-service deploy pipeline'.
  -- A key nobody can identify is a key nobody dares revoke.
  label         TEXT NOT NULL,

  -- The policy row this key inherits. Its limits apply unchanged.
  role          TEXT NOT NULL CHECK (role IN ('demo', 'dev', 'qa', 'admin')),

  -- Optional narrowing, never widening. NULL means "whatever the role allows".
  -- A key that could grant more than its role would be a second permission
  -- system, and the first one would stop being the truth.
  allowed_refs  TEXT,            -- comma-separated; intersected with the role's
  max_workers   INTEGER,         -- the lower of this and the role's wins

  created_by    TEXT NOT NULL,   -- the admin who issued it
  created_at    TEXT NOT NULL,

  -- What makes an unused key visible. A credential nobody can tell is unused
  -- is a credential nobody removes.
  last_used_at  TEXT,

  -- Revocation is a column, not a DELETE: a revoked key's runs stay
  -- attributable, and deleting the row would orphan them.
  revoked_at    TEXT
);

-- Every lookup filters on this, and an unrevoked-key scan is the hot path.
CREATE INDEX idx_api_keys_active ON api_keys (revoked_at);
