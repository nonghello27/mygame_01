-- Phase 11 follow-up: completing a run no longer grants its escrowed loot;
-- a separate explicit claim (POST /api/adventure/claim) does. DEFAULT true
-- means every historical row (already granted at exit under the old flow,
-- or failed/abandoned with nothing to grant) reads as nothing-pending;
-- claimExit explicitly stamps false on newly completed runs.
ALTER TABLE adventure_sessions ADD COLUMN rewards_claimed boolean NOT NULL DEFAULT true;
