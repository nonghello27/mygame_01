# AGENT_WORKFLOW.md — how AI sessions run implementation work in this repo

The operating procedure for the main AI session (any model) acting as
**planner / project manager**. The main session NEVER writes or edits code
itself — it explores read-only, writes precise specs, delegates every file
edit to the `implementer` subagent, and reviews every round before
approving. This split exists to put a review gate between planning and
code; skipping the review step defeats the point. Written 2026-07-08 after
Phase 10 shipped through this exact loop.

Read this top to bottom before starting a task. CLAUDE.md is the contract
for WHAT the code must look like; this file is the contract for HOW the
work flows.

## Phase A — Understand & explore (main session, read-only)

1. Read CLAUDE.md fully. Answer "what next?" from docs/ROADMAP.md's current
   position — never invent scope beyond the phase you're in.
2. Read the ACTUAL files the change will touch before writing any spec:
   the domain's `server/routers/<domain>.js` table, the route handler, the
   service, the repo, and the `src/ui/` + `src/services/` counterparts.
   Docs describe intent; the code is the truth — note exact helper names,
   error-message wording, and line anchors you'll cite in the spec.
3. Name the precedent for each piece BEFORE specifying it. Almost nothing
   in this repo is new: money/locks are claim-first-then-pay with LIFO
   compensation (`performSummon`), timed state is lazy settle
   (`settleActivities`/`settleTournaments`), pickers copy the Adventure/
   Arena party picker, panels are the msgs+body refresh-on-open shell,
   registries are closed sets (`NODE_RESOLVERS`/`REWARD_GRANTERS`). A spec
   that names its precedent gets a faithful implementation; one that
   doesn't gets an invention.

## Phase B — Plan & spec

4. Split the work into independently shippable rounds — one implementer
   round per sub-phase, sequential whenever rounds touch the same files
   (parallel rounds on shared files WILL collide). If the roadmap itself
   changes (new phase, renumbering), that restructure is its own round,
   delegated and reviewed like code.
5. Track rounds with the task tools (TaskCreate/TaskUpdate, blockedBy for
   ordering) so a resumed or compacted session can see where it is.
6. Each round's spec must contain, explicitly:
   - repo path + "read CLAUDE.md first" + "do not commit" + "match
     existing file style";
   - exact files, function signatures, and router-table rows to add;
   - the validation ladder with exact status codes AND message wording —
     mirror an existing gate's messages (e.g. `saveDefense`'s) instead of
     inventing new phrasing;
   - which docs to update in the same change (CLAUDE.md §3 tree/flow,
     docs/ARCHITECTURE.md endpoint list, docs/ROADMAP.md ✅ stamp);
   - verification commands (`npm test`, `npm run build`, plus a new
     `tests/*.test.mjs` when the round adds a pure helper — pure logic is
     the cheap place to lock behavior);
   - what the completion report must contain (files changed, key
     decisions, test/build tails) so review can start from it.

## Phase C — Delegate

7. Use the `implementer` subagent for ALL edits (code AND docs),
   synchronous (`run_in_background: false`) so review follows immediately.
8. If a round dies mid-task (API error, cutoff), do NOT re-spawn fresh:
   resume the SAME agent via SendMessage with "check what's already on
   disk (git diff / re-read) so you don't duplicate work, then finish the
   remaining steps and send the full report". Partial edits are on disk;
   a fresh agent double-applies them.
9. If the implementer flags a deviation from the spec in its report, treat
   it as a review item, not noise — decide explicitly and say so in the
   reply or the user summary.

## Phase D — Review (main session, EVERY round — never skip, never trust)

10. `git diff` the round and read every hunk. The checklist that has
    actually caught things here:
    - **Server-authoritative (CLAUDE.md §1.1):** nothing a handler trusts
      from the body could the server derive itself; ownership/role/busy
      re-derived from the DB per request; ids are choices, stats never.
    - **Once-only:** anything paying, locking, or resolving is a guarded
      claim (WHERE carries the whole gate) with compensation in LIFO
      order after a won claim — a precheck-then-act pair is a race bug.
    - **Cross-file assumptions:** verify every assumption a hunk makes
      about a NEIGHBOR it didn't change. Phase 10 examples: party.js
      reads `lane.monsterId` → confirm `makeUnit()`'s spread preserves
      it; a new `/api/admin/trainers/update` path → confirm the Vercel
      catch-all matches sub-paths (it does; the bare prefix doesn't);
      moved buttons → grep all 14 ids resolve exactly once; new CSS →
      grep every `var(--*)` it references exists in base.css.
    - **Client purity:** replayer/UI never compute outcomes; panels
      re-render from what the acted-on endpoint returned, not from
      client-side math.
    - **Engine changes:** golden logs regenerated intentionally in the
      same round, or the diff must not touch `shared/engine/`.
    - **Docs sync:** CLAUDE.md/ARCHITECTURE/ROADMAP updated in the same
      round; ROADMAP heading stamped `✅ CODE COMPLETE (date)`.
11. Re-run `npm test` and `npm run build` YOURSELF. The implementer's
    report saying they pass is a claim, not evidence.
12. Findings go back to the same implementer via SendMessage with exact
    file:line and the required fix; re-review the follow-up diff. Only
    then mark the round's task completed.

## Phase E — Wrap up

13. Final pass over the FULL working-tree diff (`git diff --stat` scope
    check: a client-only round must show nothing under `server/` or
    `shared/`).
14. Report to the user leading with the outcome; flag anything tests
    can't cover (visual/UX changes need a manual `npm run dev` pass).
15. Commit ONLY when the user asks. Match the history's `feat:` style,
    one commit per phase or sub-phase as they prefer.
