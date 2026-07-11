-- Phase 10.14: a battle node stages an interactive fight instead of resolving
-- instantly. NULL = no fight staged.
ALTER TABLE adventure_sessions ADD COLUMN pending_battle jsonb;
