# From tooth chart to bill: a dental treatment and cost plan on FHIR

A FHIR Camp hackathon project. One team, one day, one live demo.

Pitch slides: [`docs/slides.html`](docs/slides.html) (open in a browser, arrow keys to move).

## The idea

Before a crown or a bridge, every dental practice in Germany writes a
treatment and cost plan (the "HKP", *Heil- und Kostenplan*). It is a tooth
chart with the findings, the planned treatment, a few alternatives for the
patient, and what each alternative costs. Today it lives in closed practice
software.

In one day we build that chain on FHIR, running on Aidbox:

```
findings on an odontogram       Observation / Condition
  -> treatment alternatives     CarePlan (intent = option, the chosen one intent = plan)
  -> planned charges            ChargeItem (status = planned)
     priced from a fee catalog  ChargeItemDefinition (German dental fee schedule, GOZ)
  -> a cost plan per alternative
  -> pre-authorization          Claim (use = preauthorization) and ClaimResponse
```

**Demo goal:** chart the findings, plan a bridge across three teeth, compare
two alternatives by cost, choose one, and send it for pre-authorization. Every
step is visible as FHIR resources in Aidbox.

**Who we're looking for:** frontend developers, FHIR modellers, anyone who
knows billing or claims in any country, and dental people if you're here. No
dental knowledge required.

All data is synthetic.

## Public resources

### FHIR

| Resource | Link |
|---|---|
| German Dental FHIR Profiles (IG), current release | https://fhir.cognovis.de/dental/0.57.2/ |
| Dental care plan profile (HKP, PAR, KFO, ZE plans) | https://fhir.cognovis.de/dental/0.57.2/StructureDefinition-dental-care-plan.html |
| Dental use cases, including the HKP workflow | https://fhir.cognovis.de/dental/0.57.2/usecases.html |
| Dental FHIR package (`de.cognovis.fhir.dental#0.57.2`) | https://fhir.cognovis.de/dental/0.57.2/package.tgz |
| Dental Core FHIR Profiles (country-neutral odontogram contracts) | https://fhir.cognovis.de/dental-core/0.10.2/ |
| All cognovis guides | https://fhir.cognovis.de/ |
| FHIR R4: CarePlan, ChargeItem, ChargeItemDefinition, Claim | https://hl7.org/fhir/R4/careplan.html, https://hl7.org/fhir/R4/chargeitem.html, https://hl7.org/fhir/R4/chargeitemdefinition.html, https://hl7.org/fhir/R4/claim.html |

### Billing SDK

The cognovis Billing SDK (Apache-2.0) evaluates billing rules over FHIR
resources: ChargeItems, ChargeItemDefinitions and rule sets carried as
`Library` resources. It also runs offline on FHIR bundles, without a server.

```sh
npm config set @cognovis:registry https://npm.cognovis.de
npx -p @cognovis/fhir-billing-sdk fhir-billing-check --help
```

| Package | Link |
|---|---|
| `@cognovis/fhir-billing-sdk` | https://npm.cognovis.de/@cognovis%2Ffhir-billing-sdk |
| `@cognovis/fhir-sdk` (FHIR client and types) | https://npm.cognovis.de/@cognovis%2Ffhir-sdk |

### Odontogram

| Resource | Link |
|---|---|
| React Advanced Odontogram by Zoltán Dul (MIT), the upstream project the starter app uses | https://github.com/ZoliQua/React-Advanced-Odontogram |
| The same, as npm package `react-advanced-odontogram` | https://www.npmjs.com/package/react-advanced-odontogram |

### Fee catalog

| Resource | Link |
|---|---|
| GOZ, the German dental fee schedule (statutory text) | https://www.gesetze-im-internet.de/goz_1987/ |

### Aidbox

| Resource | Link |
|---|---|
| Aidbox, free dev instance or local Docker | https://aidbox.app |
| Aidbox user portal (free development license) | https://aidbox.app/ui/portal |
| Run Aidbox locally | https://www.health-samurai.io/docs/aidbox/getting-started/run-aidbox-locally |
| Aidbox documentation | https://www.health-samurai.io/docs/aidbox |

## Getting started

You need Docker (with Compose), Node.js 20 or newer, and a free Aidbox account.
Everything runs on your machine; all data is synthetic.

```sh
git clone https://github.com/cognovis/fhir-camp-hackathon.git
cd fhir-camp-hackathon

# 1. Aidbox license (optional here, see below)
cp .env.example .env          # then paste your key into BOX_LICENSE, or skip it

# 2. Start Aidbox and its database (the first start pulls about 1.1 GB of images)
docker compose up -d

# 3. Install the Node dependencies (the starter app and the billing tools)
npm install

# 4. Install the dental FHIR packages, load catalog and patients, validate
npm run setup

# 5. The starter app: odontogram on FHIR data from your Aidbox
npm run app                   # http://localhost:5173
```

**Aidbox license.** Aidbox needs a license; a development license is free. Either:

- create a free account in the [Aidbox user portal](https://aidbox.app/ui/portal), create a
  *Development* license for a *self-hosted* instance, and put the key into `.env` as
  `BOX_LICENSE=...` before `docker compose up -d`, or
- leave `BOX_LICENSE` out, run `docker compose up -d`, open <http://localhost:8080> and log in
  with your Aidbox account to activate. `npm run setup` tells you if this step is missing.

The development license allows no real patient data, which suits this kit.

`npm run setup` takes about a minute on a fresh instance and ends with
`Validation: 141 profile checks passed, 0 errors.` It can be run again at any time; it
reloads the data and keeps your own resources.

**Aidbox UI:** <http://localhost:8080>, user `admin`, password `hackathon`. The REST API takes
Basic auth with client `root`, secret `hackathon`, for example
`curl -u root:hackathon http://localhost:8080/fhir/Patient`. These are local throw-away
credentials; do not reuse them. Port 8080 taken? Set `AIDBOX_PORT` in `.env`; Docker Compose, the setup script, the
app and the cost plan all read it.

### Billing check and cost plan

```sh
npm run billing:check            # Billing SDK decision per cost plan of the example patient
npm run billing:check:blocked    # a cost plan that breaks all three hackathon rules
npm run cost-plan                # line prices and totals per treatment alternative
```

Expected: alternatives A and B `allow`, C `unavailable` (multiplier 3.0 without a
justification), totals 549.26, 428.44 and 673.59 EUR.

## What is in the kit

| Folder | What it is |
|---|---|
| `docker-compose.yml` | Aidbox 2610 (latest stable) and PostgreSQL 18 |
| `scripts/setup.mjs` | Installs `de.cognovis.fhir.dental.core#0.10.2` and `de.cognovis.fhir.dental#0.57.2` with their public dependencies, loads catalog and patients, validates against the installed profiles |
| `data/` | Four synthetic dental patients. **Greta Palmried (`dent-051`)** has the complete chain: chart, finding, three treatment alternatives as `CarePlan`, 25 planned `ChargeItem`s, one cost plan `Account` per alternative. See [data/README.md](data/README.md) |
| `catalog/` | The GOZ fee catalog as 215 FHIR `ChargeItemDefinition`s, generated from the official BMJV XML. Generated for the hackathon, not a billing-grade catalog. See [catalog/README.md](catalog/README.md) |
| `billing/` | A synthetic GOZ rule set as a FHIR `Library`, the billing check with `@cognovis/fhir-billing-sdk` 0.35.0, and the cost plan calculation. See [billing/README.md](billing/README.md) |
| `app/` | The starter app: Vite, React and TypeScript, with the MIT odontogram `react-advanced-odontogram`. Shows the chart of a seeded patient, findings and treatment alternatives, and the planned chart of each alternative. The chart code sits behind one integration point (`app/src/odontogram/`), so another chart component can replace it |
| [TASKS.md](TASKS.md) | Seven ready-to-pick tasks along the chain |
| [AGENTS.md](AGENTS.md), `.agents/skills/` | Instructions and skills for coding agents (Claude Code reads them through `CLAUDE.md` and `.claude/skills`): Aidbox in the kit, writing valid FHIR, FHIR IG development in FSH, and the Billing SDK |
| `docs/slides.html` | Pitch slides for the project |

## Known gaps

- **Billing FHIR package not published.** `de.cognovis.fhir.dental#0.57.2` depends on
  `de.cognovis.fhir.billing#0.5.3` and `de.cognovis.terminology.dental.dpf-kuerzel#1.1.0`,
  which are on no public registry yet. The setup installs the dental package without them.
  Everything the kit uses works, but the IG's German ChargeItem and invoice profiles
  (`goz-charge-item` and others) cannot be validated: they require an extension from the
  billing package. The planned ChargeItems are therefore plain FHIR R4. The Billing SDK does
  not need the package.
- **The cognovis fork of the odontogram** (FHIR mapping, bridges, plan alternatives) is not
  published. The starter app uses the public upstream and maps FHIR to the chart itself.
- **GOZ catalog prices**: a single fee per number, rounded to cents, with points and point value
  kept alongside; numbers priced as a share of another have no price. See
  [catalog/README.md](catalog/README.md).

## License

Everything in this repository is licensed under the MIT License (see
[LICENSE](LICENSE)). Linked projects keep their own licenses.
