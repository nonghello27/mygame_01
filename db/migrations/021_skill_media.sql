-- 021_skill_media — the same concept 020_class_icon.sql applied to classes,
-- now applied to SKILLS: two media columns on the skills MASTER TABLE so
-- per-skill art is admin-adjustable live instead of requiring a redeploy.
--
-- Both nullable:
--   icon      -- a base filename (no extension) under public/icons/skills/.
--              NULL falls back to the skill's slot placeholder
--              (passive/normal/ultimate), then default.png -- see
--              public/icons/skills/README.md for the full lookup order.
--   animation -- a full FILENAME (extension included) under
--              public/anim/skills/. The extension picks the renderer:
--              .svg -> a self-animating SVG shown via <img>; .png -> a
--              horizontal CSS sprite strip of square frames. NULL means the
--              skill has no animation yet -- see public/anim/skills/README.md.
--
-- Same CAUTION as every migration: the runner splits statements on ';'
-- after stripping full-line comments -- no semicolons inside inline
-- `--` comments.

ALTER TABLE skills ADD COLUMN icon TEXT;
ALTER TABLE skills ADD COLUMN animation TEXT;
