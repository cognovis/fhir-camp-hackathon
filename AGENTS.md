# Agent instructions

This is the FHIR Camp starter kit: a dental treatment and cost plan on FHIR, running on a
local Aidbox. Read `README.md` for setup and `TASKS.md` for the work.

## Skills

Load the skill that fits the task from `.agents/skills/` (`.claude/skills` points there):

| Skill | Use when |
| --- | --- |
| `aidbox-in-the-kit` | Starting, loading, querying, validating or debugging the local Aidbox |
| `fhir-emission` | Code writes FHIR resources (chart, plans, charges, claims) |
| `fhir-ig-development` | A task needs a new profile, extension, value set or a small IG in FSH |
| `billing-sdk` | Billing check, cost plan prices, the rule set, a new rule, `@cognovis/fhir-sdk` |

## Rules

- Public repository, MIT. Put in only what you may publish under MIT: no credentials, no
  real patient or practice data, no licensed content (for example KZBV Festzuschuss, BEL II
  or BEB values, SNOMED CT content).
- All data is synthetic and carries the meta tag `HTEST`. Keep it that way.
- The Aidbox credentials (`root` / `hackathon`, `admin` / `hackathon`) are local throw-away
  values. The app reaches Aidbox only through the Vite proxy; never put credentials into
  browser code.
- Settings come from `.env` (see `.env.example`); never commit `.env`.
- Keep the pinned versions (Aidbox image, dental packages, `@cognovis/*` SDKs); the kit is
  tested with them.
- Code, comments and docs in English. UI strings may be German.

## Checks before you hand over

```sh
npm run validate                       # 0 errors (seeded resources only)
npm run billing:check                  # A, B allow; C unavailable
npm --workspace app run typecheck
```

A change that writes resources is proven by `$validate` against the profile it claims,
not by a green typecheck.
