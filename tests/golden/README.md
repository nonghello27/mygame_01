# Golden battle logs

Exact expected outputs of `shared/engine/resolveBattle()` for the fixture
rosters in `tests/resolve.test.mjs`. A diff here means the combat rules
changed — that must be intentional, reviewed, and land in the same commit as
the rules change.

Regenerate after an intentional rules change:

```bash
node tests/golden/regen.mjs
```
