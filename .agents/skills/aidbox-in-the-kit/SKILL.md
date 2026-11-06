---
name: aidbox-in-the-kit
description: Start, load, query, validate and debug the kit's local Aidbox (Docker Compose). Use when a task reads or writes FHIR resources in Aidbox, when setup fails, or when the app cannot reach the server.
---

# Aidbox in the kit

## Start and load

```sh
cp .env.example .env         # optional: BOX_LICENSE=... (never an empty value)
docker compose up --build    # Aidbox + Postgres, one-shot setup, starter app on :5173
```

- The stack has four services: `postgres`, `aidbox`, `setup` (installs packages, loads
  catalog and patients, validates, exits) and `app` (Vite dev server, `app/src` mounted).
  `app` starts only after `setup` exited successfully. Follow them with
  `docker compose logs -f setup app`.
- Working on the host instead: `docker compose up -d aidbox`, then `npm install`,
  `npm run setup`, `npm run app` (Node.js 22.12 or newer).
- The setup is safe to repeat (`docker compose up` again, or `npm run setup`); it reloads
  the seed data and keeps your own resources.
- App changes outside `app/src` (dependencies, `vite.config.ts`) need
  `docker compose up --build`.
- `npm run validate` re-runs the profile checks of the seeded resources only. Expected end:
  `Validation: 141 profile checks passed, 0 errors.` Resources you create are not in it;
  check them with `$validate` (below).
- Not activated yet: every request answers with a redirect. The `setup` container waits
  and says so in its log; `npm run setup` on the host fails with the same hint. Open
  http://localhost:8080 and log in with your Aidbox account, or put a development licence
  from https://aidbox.app/ui/portal into `.env` as `BOX_LICENSE`.
- An empty `BOX_LICENSE=` makes Aidbox crash at start ("License is invalid"). Remove the
  line or fill it.
- Port taken: set `AIDBOX_PORT` or `APP_PORT` in `.env`; Compose, the app and the scripts
  follow it.

## Access

- REST: `http://localhost:8080/fhir/...`, Basic auth client `root`, secret `hackathon`:
  `curl -u root:hackathon 'http://localhost:8080/fhir/Patient?_count=5'`
- UI: http://localhost:8080, user `admin`, password `hackathon`.
- The starter app calls `/fhir` on its own origin; Vite proxies it to Aidbox and adds the
  credentials server-side (`app/vite.config.ts`), so they never reach the browser bundle.
  Keep it that way.
- These are local throw-away credentials. Never commit others, and never point the kit at a
  server with real patient data.

## Useful queries for the example patient

```text
Patient?identifier=https://github.com/cognovis/fhir-camp-hackathon/sid/patient|
Observation?subject=Patient/dent-051&_profile=https://fhir.cognovis.de/dental-core/StructureDefinition/dental-tooth-state
CarePlan?subject=Patient/dent-051
ChargeItem?subject=Patient/dent-051
Account?subject=Patient/dent-051
ChargeItemDefinition/goz-5010            (R4 has no `code` search on ChargeItemDefinition)
```

## Packages and validation

- Packages go in through `POST /fhir/$fhir-package-install` (see `scripts/setup.mjs`).
  Only that route makes profiles and terminology resolvable for `$validate` and required
  bindings. A `PUT` of a StructureDefinition stores it but does not install it.
- Validate one resource against the profile it claims:
  `POST /fhir/<Type>/$validate?profile=<canonical>`. Pass = no issue with severity
  `error` or `fatal`.
- Before you debug a validation failure, check the package is installed: read the
  profile's StructureDefinition back by its canonical URL. A missing package install is a
  more common cause than a broken resource.
- Do not switch the whole instance to strict validation to make something pass.

## Resetting

- Reload the seed: `docker compose up` (re-runs `setup`) or `npm run setup`.
- Start from an empty database: `docker compose down`, then remove the Postgres volume
  with `docker volume ls` / `docker volume rm <project>_postgres_data`, and
  `docker compose up`. This deletes everything you created.

## Docs

- Aidbox: https://www.health-samurai.io/docs/aidbox
- Run locally: https://www.health-samurai.io/docs/aidbox/getting-started/run-aidbox-locally
