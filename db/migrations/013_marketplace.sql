-- 013_marketplace — player-to-player economy (Phase 8, promoted from its
-- original slot as sub-phase 7.5). Gold finally circulates trainer to
-- trainer instead of only faucet (jobs, season payouts) → sink (Summon
-- Hall, enhance, repair). This migration is schema + master-data plumbing
-- ONLY — no market endpoints/services/UI land yet, see docs/ROADMAP.md's
-- "Phase 8 — Marketplace" section for the full spec this sets up.
--
-- marketplace_listings is the instance table for one player-to-player
-- listing, same "instance row referencing master content" shape as
-- everything else (CLAUDE.md §1.3), except what it references is itself
-- another INSTANCE (an owned item stack / equipment piece / rune / monster)
-- rather than a master def — a listing escrows a real good, it doesn't mint
-- a new one. `kind` says which owned-goods table `ref_id` points into:
--   item      — no instance id (item stacks have none); `def_id` names the
--               item_defs row directly and `qty` is how many were split off
--               the trainer's stack into escrow.
--   equipment — `ref_id` is a row in EITHER trainer_equipment OR
--               monster_equipment, whichever domain the referenced
--               equipment_defs row (`def_id`) declares — there is no single
--               "equipment instances" table, so the listing itself doesn't
--               disambiguate; the service layer resolves domain via
--               equipment_defs.domain before touching ref_id.
--   rune      — `ref_id` is a row in runes.
--   monster   — `ref_id` is a row in monsters; `def_id` denormalizes the
--               monster's species id for search/display without a join.
-- `def_id` is ALWAYS set (even for instance kinds) purely for browse/search
-- convenience — the authoritative "what is this" is `ref_id` (or, for
-- items, the (kind, def_id) pair itself, since items have no instance row).
-- `qty` is only ever >1 for kind='item'; every other kind lists exactly one
-- instance. `status` starts 'open', ends 'sold' (with `buyer_id`/
-- `closed_at` set) or 'cancelled' (`closed_at` set, no buyer) — a listing
-- never resolves twice, same "settle exactly once" precedent as
-- activities/matches/summons.
--
-- Escrow is why a listed good is safe to sell atomically: listing an item
-- splits qty off the stack, unsockets/unequips gear first (server-
-- validated, not enforced by this schema), and detaches a monster to the
-- unassigned state — the good is out of the seller's usable inventory the
-- moment it's listed, so it can never be used/mutated between list and buy.
-- Cancel reverses exactly that (returns qty / re-attaches). This is why the
-- ALTERs below exist: an escrowed equipment/rune instance needs to be
-- ownerless (trainer_id = NULL) while it sits in a listing, the SAME
-- "unassigned instance" precedent 012_monster_release.sql set for monsters
-- (there, detaching from a trainer; here, detaching INTO escrow). Without
-- this, an escrowed piece would have to stay attributed to the seller,
-- which would either still count as "theirs" for busy/slot checks or force
-- a fake trainer_id — both worse than allowing the same NULL state monsters
-- already use.
--
-- Indexes: (status, kind) serves the browse/search read (open listings of
-- one kind, newest first); (seller_id) serves "my listings".
--
-- sell_gold on item_defs/equipment_defs/rune_defs is the OTHER half of
-- Phase 8: the instant sell-to-system price per unit, set per master def
-- (balance data, seeded from src/data/*.js, editable live in the admin
-- console). 0 means "not sellable to the system" — every nonzero sell_gold
-- is the natural price floor a marketplace listing for that def should sit
-- above. Monsters get no such column: they are marketplace-only, never
-- sellable to the system.
--
-- Same CAUTION as every migration: the runner splits statements on ';'
-- after stripping full-line comments — no semicolons inside inline
-- `--` comments.

CREATE TABLE IF NOT EXISTS marketplace_listings (
  id         BIGSERIAL   PRIMARY KEY,
  seller_id  BIGINT      NOT NULL REFERENCES trainers(id),
  kind       TEXT        NOT NULL CHECK (kind IN ('item', 'equipment', 'rune', 'monster')),
  def_id     TEXT,        -- master-def id, for kind='item' this IS the good (stacks have
                           -- no instance id), for instance kinds it's denormalized for
                           -- search/display alongside the authoritative ref_id
  ref_id     BIGINT,       -- instance id for equipment/rune/monster, NULL for items,
                           -- equipment's ref_id points into trainer_equipment OR
                           -- monster_equipment depending on the def's domain
  qty        INT         NOT NULL DEFAULT 1 CHECK (qty >= 1),  -- only >1 for kind='item'
  price      INT         NOT NULL CHECK (price > 0),
  status     TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'sold', 'cancelled')),
  buyer_id   BIGINT      REFERENCES trainers(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS marketplace_listings_status_kind_idx
  ON marketplace_listings (status, kind);
CREATE INDEX IF NOT EXISTS marketplace_listings_seller_idx
  ON marketplace_listings (seller_id);

-- Escrowed equipment/runes become ownerless (trainer_id = NULL) while
-- listed — same "unassigned instance" precedent 012_monster_release.sql
-- set for monsters, now extended to the other instance tables so a listing
-- can hold them without attributing them to the seller.
ALTER TABLE trainer_equipment ALTER COLUMN trainer_id DROP NOT NULL;
ALTER TABLE monster_equipment ALTER COLUMN trainer_id DROP NOT NULL;
ALTER TABLE runes ALTER COLUMN trainer_id DROP NOT NULL;

-- Per-unit instant sell-to-system price; 0 = not sellable to the system.
ALTER TABLE item_defs ADD COLUMN IF NOT EXISTS sell_gold INT NOT NULL DEFAULT 0 CHECK (sell_gold >= 0);
ALTER TABLE equipment_defs ADD COLUMN IF NOT EXISTS sell_gold INT NOT NULL DEFAULT 0 CHECK (sell_gold >= 0);
ALTER TABLE rune_defs ADD COLUMN IF NOT EXISTS sell_gold INT NOT NULL DEFAULT 0 CHECK (sell_gold >= 0);
