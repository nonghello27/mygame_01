-- 019_ranks — Phase 10.9's foundation slice: a rank column (D/C/B/A/S/SR/SSR,
-- shared/rules/ranks.js's RANKS, ascending) on BOTH master (monster_species)
-- and instance (monsters) rows. Master carries the baseline; an owned
-- monster copies its species' rank at mint time (server/repos/monsters.js's
-- mintMonster()) and then lives its own life from there — admin-editable
-- today, meant to become player-upgradeable in a later phase.
--
-- On a repo that's already live, existing species rows predate this column
-- entirely, so the backfill below assigns each one a RANDOM rank (a one-time
-- placeholder — an admin can re-grade them for real afterward) and then
-- copies that rank onto every monster already minted from it. A fresh DB
-- instead gets ranks from src/data/units.js's seed data via db:seed, so
-- both UPDATEs below hit zero rows there.
--
-- Same CAUTION as every migration: the runner splits statements on ';'
-- after stripping full-line comments -- no semicolons inside inline
-- `--` comments.

ALTER TABLE monster_species ADD COLUMN IF NOT EXISTS rank TEXT NOT NULL DEFAULT 'D' CHECK (rank IN ('D','C','B','A','S','SR','SSR'));

ALTER TABLE monsters ADD COLUMN IF NOT EXISTS rank TEXT NOT NULL DEFAULT 'D' CHECK (rank IN ('D','C','B','A','S','SR','SSR'));

UPDATE monster_species SET rank = (ARRAY['D','C','B','A','S','SR','SSR'])[1 + floor(random()*7)::int];

UPDATE monsters m SET rank = s.rank FROM monster_species s WHERE m.species_id = s.id;
