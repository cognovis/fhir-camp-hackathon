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

## Data sources

- Local Aidbox: FHIR API at `http://localhost:${AIDBOX_PORT:-8080}/fhir`, from the app only
  through the Vite proxy at `/fhir`. The `aidbox-in-the-kit` skill covers start, load and queries.
- Synthetic data: `data/*.json`, `catalog/goz-catalog.bundle.json` and the `goz-real-*.json`
  bundles in `billing/examples/`, loaded by `npm run setup` (list in `scripts/setup.mjs`,
  `bundleFiles`).
- FHIR packages, IG pages and the npm registry `https://npm.cognovis.de` (no login): README,
  "Public resources".

## Upstream repositories

A fix or question about a dependency belongs in the repository that owns it: open the issue or
pull request there. The kit keeps its pinned version until that repository releases a new one.

| Artifact | Repository for issues and pull requests |
| --- | --- |
| This kit: app, seed data, billing scripts, skills | https://github.com/cognovis/fhir-camp-hackathon |
| `@cognovis/react-odontogram`, the chart | https://github.com/cognovis/React-Odontogram-Modul (forked from https://github.com/ZoliQua/React-Advanced-Odontogram) |
| `@cognovis/fhir-billing-rules`, `-engine`, `-types`, the Billing Core IG | https://github.com/cognovis/fhir-billing-core (read its `CONTRIBUTING.md`) |
| `@health-samurai/react-components`, the FHIR panel | https://github.com/HealthSamurai/aidbox-ts-sdk |
| `@cognovis/fhir-billing-sdk`, `@cognovis/fhir-sdk`, the dental IGs | Source not public: open the issue in this kit's repository. Docs: https://fhir.cognovis.de/ |

Aidbox itself is not open source; its documentation is https://www.health-samurai.io/docs/aidbox.
General libraries (React, Radix UI, i18next, Vite) are listed in `app/package.json`.

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
