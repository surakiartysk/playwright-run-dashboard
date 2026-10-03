-- Wrong passwords, counted per address, so sign-in stops listening to a guesser.
--
-- One row per address rather than one per attempt: the question asked on every
-- sign-in is "how many in this window?", and a counter answers it with a
-- single read. A row per attempt would answer it with a COUNT and grow by one
-- for every guess a script makes — the table would be the thing the script
-- filled. See decision 28.
CREATE TABLE login_attempts (
  -- CF-Connecting-IP. Cloudflare sets it and overwrites any value a caller
  -- sends, so it is the one address here a client cannot choose.
  client        TEXT PRIMARY KEY,

  -- Charged before the password is checked and refunded if it was right, so
  -- this is the number of wrong passwords plus any attempts still in flight.
  attempts      INTEGER NOT NULL,

  -- When the current window opened. A window that has passed starts over at
  -- one rather than being deleted — nothing sweeps this table.
  window_start  TEXT NOT NULL
);
