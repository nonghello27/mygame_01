-- Battle Line — database schema (Neon / Postgres).
-- Run via `npm run db:seed` (db/seed.mjs executes this then loads the rows).
-- Ids are the same stable strings the game already uses (class name, sprite id),
-- so they double as the DB keys.

-- Unit-TYPE master data: Knight, Archer, Lancer, ... Each row links a class to
-- its attack name + cutscene effect key (consumed by the cutscene engine).
CREATE TABLE IF NOT EXISTS classes (
  cls         TEXT PRIMARY KEY,        -- e.g. 'Knight'
  attack_name TEXT NOT NULL,           -- e.g. 'Blade Arc'
  fx          TEXT NOT NULL            -- effect key, e.g. 'slash'
);

-- Roster unit definitions (the templates the engine clones into live units).
-- army is 'A' (player) or 'B' (enemy). ord is the lane order, 0 = FRONT.
CREATE TABLE IF NOT EXISTS units (
  id     SERIAL PRIMARY KEY,
  army   TEXT    NOT NULL CHECK (army IN ('A', 'B')),
  ord    INTEGER NOT NULL,             -- lane position, 0 = front
  name   TEXT    NOT NULL,
  cls    TEXT    NOT NULL REFERENCES classes(cls),
  emoji  TEXT    NOT NULL,
  hp     INTEGER NOT NULL,
  atk    INTEGER NOT NULL,
  spd    INTEGER NOT NULL,
  sprite TEXT,                         -- optional sprite-sheet id (data/sprites.js)
  UNIQUE (army, ord)
);
