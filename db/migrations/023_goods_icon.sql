-- 023_goods_icon — the same concept 020_class_icon.sql/021_skill_media.sql
-- applied to classes/skills, now applied to GOODS: an icon column on each of
-- the three goods master tables (item_defs, equipment_defs, rune_defs) so
-- per-good art is admin-adjustable live instead of requiring a redeploy.
--
-- Nullable: NULL means "derive from the def id" (e.g. it_potion_small ->
-- it_potion_small.png), then default.png -- see public/icons/items/README.md,
-- public/icons/equipment/README.md, public/icons/runes/README.md for the
-- full lookup order.
--
-- Same CAUTION as every migration: the runner splits statements on ';'
-- after stripping full-line comments -- no semicolons inside inline
-- `--` comments.

ALTER TABLE item_defs ADD COLUMN IF NOT EXISTS icon TEXT;
ALTER TABLE equipment_defs ADD COLUMN IF NOT EXISTS icon TEXT;
ALTER TABLE rune_defs ADD COLUMN IF NOT EXISTS icon TEXT;
