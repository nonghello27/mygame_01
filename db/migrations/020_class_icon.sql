-- 020_class_icon — promotes the class-icon lookup from client-only data
-- (src/data/classes.js's CLASS_META.icon, added earlier in Phase 10.12)
-- onto the classes MASTER TABLE, so it's admin-adjustable live like every
-- other class field (attack_name, fx) instead of requiring a redeploy.
--
-- Nullable: NULL means "derive from the class name lowercased" (the same
-- fallback classIconEl() already used before a class ever had an explicit
-- icon) -- see public/icons/classes/README.md for the full lookup order.
--
-- Same CAUTION as every migration: the runner splits statements on ';'
-- after stripping full-line comments -- no semicolons inside inline
-- `--` comments.

ALTER TABLE classes ADD COLUMN IF NOT EXISTS icon TEXT;
