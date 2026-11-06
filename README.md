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

The packages are on the cognovis npm registry, readable without a login; they are not on
npmjs.org. Point the `@cognovis` scope there (this repository's `.npmrc` already does):

```sh
npm config set @cognovis:registry https://npm.cognovis.de
npx -p @cognovis/fhir-billing-sdk@0.42.1 fhir-billing-check --help
```

| Package | Newest | In this kit | What it is |
|---|---|---|---|
| [`@cognovis/fhir-billing-sdk`](https://npm.cognovis.de/@cognovis%2Ffhir-billing-sdk) | 0.42.1 | 0.42.1 | `fhir-billing-check` CLI and `evaluateBillingAccount` |
| [`@cognovis/fhir-billing-rules`](https://npm.cognovis.de/@cognovis%2Ffhir-billing-rules) | 0.41.1 | 0.40.0 | Rule-set format and the rule classes |
| [`@cognovis/fhir-billing-engine`](https://npm.cognovis.de/@cognovis%2Ffhir-billing-engine) | 0.41.1 | 0.40.0 (via the SDK) | The rule engine |
| [`@cognovis/fhir-billing-types`](https://npm.cognovis.de/@cognovis%2Ffhir-billing-types) | 0.41.1 | 0.40.0 (via the SDK) | Shared types |
| [`@cognovis/fhir-sdk`](https://npm.cognovis.de/@cognovis%2Ffhir-sdk) | 0.24.0 | 0.23.3 | FHIR client and profile types |

Pin the versions. `fhir-billing-sdk` 0.42.1 requires engine, rules and types `^0.40.0` (that
is 0.40.x) and accepts `fhir-sdk` `^0.23.3` but not 0.24, so the kit pins that set. The
registry's `latest` tag of `fhir-billing-sdk` still points to 0.37.1, so an unpinned
`npm install @cognovis/fhir-billing-sdk` gets the older SDK. Installing the 0.41 engine
packages next to the SDK gives you a second copy that the SDK does not use. Engine source:
<https://github.com/cognovis/fhir-billing-core>.

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

You need Docker (with Compose) and a free Aidbox account. Everything runs on your machine;
all data is synthetic.

```sh
git clone https://github.com/cognovis/fhir-camp-hackathon.git
cd fhir-camp-hackathon
cp .env.example .env          # optional: paste your Aidbox key into BOX_LICENSE (see below)
docker compose up --build     # first start pulls and builds about 1.5 GB
```

That one command starts the whole kit:

1. **Aidbox** and its database.
2. **`setup`**, a one-shot container: installs the dental FHIR packages, loads the GOZ
   catalog and the synthetic patients, validates them, and exits. It ends with
   `Validation: 141 profile checks passed, 0 errors.`
3. **`app`**, the starter app with the odontogram, on <http://localhost:5173>, as soon as
   the setup has finished. `app/src` is mounted into the container, so your edits reload in
   the browser.

Add `-d` to run it in the background; `docker compose logs -f setup app` shows the progress.
`docker compose up` again later re-runs the setup, which reloads the seed data and keeps
your own resources.

**Aidbox license.** Aidbox needs a license; a development license is free. Either:

- create a free account in the [Aidbox user portal](https://aidbox.app/ui/portal), create a
  *Development* license for a *self-hosted* instance, and put the key into `.env` as
  `BOX_LICENSE=...` before `docker compose up`, or
- leave `BOX_LICENSE` out, start the stack, open <http://localhost:8080> and log in with your
  Aidbox account to activate. The setup container waits for the activation and says so in its
  log.

The development license allows no real patient data, which suits this kit.

**Aidbox UI:** <http://localhost:8080>, user `admin`, password `hackathon`. The REST API takes
Basic auth with client `root`, secret `hackathon`, for example
`curl -u root:hackathon http://localhost:8080/fhir/Patient`. These are local throw-away
credentials; do not reuse them. Port 8080 or 5173 taken? Set `AIDBOX_PORT` or `APP_PORT` in
`.env`.

### Working on the host instead

For the billing tools, the scripts, or an app outside Docker you need Node.js 22.12 or newer:

```sh
docker compose up -d aidbox   # Aidbox and its database only
npm install
npm run setup                 # packages, catalog, patients, validation
npm run app                   # http://localhost:5173
```

On the host, `npm run setup` fails at once with instructions if Aidbox is not activated yet.
The setup script, the app and the cost plan read `AIDBOX_PORT` from `.env` as Compose does.

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
| `docker-compose.yml`, `Dockerfile` | The whole kit in one stack: Aidbox 2610 (latest stable) and PostgreSQL 18, the one-shot `setup`, and the starter `app`. The Node tools run from one image built from this repository |
| `scripts/setup.mjs` | Installs `de.cognovis.fhir.dental.core#0.10.2` and `de.cognovis.fhir.dental#0.57.2` with their public dependencies, loads catalog and patients, validates against the installed profiles |
| `data/` | Four synthetic dental patients. **Greta Palmried (`dent-051`)** has the complete chain: chart, finding, three treatment alternatives as `CarePlan`, 25 planned `ChargeItem`s, one cost plan `Account` per alternative. See [data/README.md](data/README.md) |
| `catalog/` | The GOZ fee catalog as 215 FHIR `ChargeItemDefinition`s, generated from the official BMJV XML. Generated for the hackathon, not a billing-grade catalog. See [catalog/README.md](catalog/README.md) |
| `billing/` | A synthetic GOZ rule set as a FHIR `Library`, the billing check with `@cognovis/fhir-billing-sdk` 0.42.1, and the cost plan calculation. See [billing/README.md](billing/README.md) |
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
