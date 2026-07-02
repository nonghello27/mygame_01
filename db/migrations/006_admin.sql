-- 006_admin — admin console access (Phase 5).
--
-- Master data becomes editable from inside the game, so someone has to be
-- allowed to edit it. Accounts whose email is listed in the ADMIN_EMAILS env
-- var are promoted at login (promotion only — demotion is a manual UPDATE,
-- so an env-var typo can never lock every admin out). Every /api/admin
-- handler re-checks this flag server-side.

ALTER TABLE trainers
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;
