# Billing check with the cognovis Billing SDK

**Synthetic rules, generated for the hackathon, not billing-grade.**

This folder evaluates planned `ChargeItem`s against the GOZ catalog (`../catalog`) and a
small hand-written rule set, with `@cognovis/fhir-billing-sdk` 0.42.1 (Apache-2.0). It runs
offline on FHIR bundles; no server is needed.

```sh
npm run billing:check            # the three cost plans of the example patient (dent-051)
npm run billing:check:blocked    # a cost plan that breaks all three rules
npm run cost-plan                # the same plans with line prices and totals
npm run cost-plan -- --aidbox dent-051   # read the plans from the local Aidbox instead
npm run cost-plan -- --json      # machine-readable
```

The SDK packages come from the cognovis npm registry; `../.npmrc` points the `@cognovis`
scope there, so `npm install` in the repository root fetches them without a login.

## What the check needs

Per cost plan the SDK evaluates one `Account`:

- `Account` with `coverage` pointing to a `Coverage`,
- `Coverage.contract` pointing to a `Contract` with `status = executed` and a `url`,
- the `ChargeItem`s whose `account` points to the Account (`status = planned` for a cost plan),
- the catalog edition `Library`, its `ChargeItemDefinition`s and the rule-set `Library`
  (all in `../catalog/goz-catalog.bundle.json`).

A `ChargeItem` carries the GOZ number in `code`, the tooth in `bodysite`, the multiplier in
`factorOverride` and a justification for a multiplier above 2.3 in `reason[].text`.

`data/dent-051-palmried.json` has three cost plans (Accounts `dent-051-cost-plan-a/-b/-c`),
one per treatment alternative (`CarePlan` `dent-051-hkp-alt-a/-b/-c`). Each planned
ChargeItem points to its CarePlan in `supportingInformation`.

## Results

| Case | Decision | Why |
|---|---|---|
| `dent-051-cost-plan-a` (bridge, veneered) | `allow` | |
| `dent-051-cost-plan-b` (bridge, full cast) | `allow` | |
| `dent-051-cost-plan-c` (implant) | `unavailable` | GOZ 9010 at multiplier 3.0 without a justification: `MULTIPLIER_JUSTIFICATION_REQUIRED` (needs review). Add a `reason` text to `dent-051-alt-c-05` and it becomes `allow`. |
| `example-blocked` | `block` | `QUANTITY_CAP_EXCEEDED`, `MUTUALLY_EXCLUSIVE_CODE_PRESENT`, `MULTIPLIER_OUT_OF_BOUNDS` |

The CLI calls a needs-review finding `unavailable`. `CATALOG_PARTIAL` is an advisory: the
edition does not claim to be the complete GOZ.

## The rule set

`goz-hackathon-rules.json` is the rule payload; `build-catalog.mjs` wraps it into the
rule-set `Library` (`https://github.com/cognovis/fhir-camp-hackathon/Library/goz-hackathon-rules`).
The rules are written for this kit and are deliberately simplified:

| Rule | Class | What it checks | Basis |
|---|---|---|---|
| `goz-multiplier-bounds` | `bounded-multiplier` | Multiplier between 1.0 and 3.5; above 2.3 only with a justification | GOZ § 5 and § 10, simplified |
| `goz-0030-once-per-cost-plan` | `quantity-limit` | GOZ 0030 (written cost plan) at most once per cost plan | invented for the exercise |
| `goz-9050-not-with-9010-9040` | `mutual-exclusion` | GOZ 9050 not together with 9010 or 9040 | GOZ Anlage 1, text of 9050 |

Each rule records its basis as `provenance.evidenceLevel`. After editing the payload, run
`npm run build-catalog` and reload with `npm run setup`.

What the rule classes cannot express today: a limit per tooth (the SDK counts per cost plan,
not per tooth), and the price of the six GOZ numbers that are a share of another number. See
`../TASKS.md`.

## Cost plan from a CarePlan

`charges-from-plan.mjs` generates the cost plan of one treatment alternative in the local
Aidbox: one `Account` and one planned `ChargeItem` per CarePlan activity, in the shape of the
seeded ones.

```sh
npm run charges-from-plan -- <CarePlan id>                       # write to Aidbox
npm run charges-from-plan -- dent-051-hkp-alt-c --factor 9010=3.0  # multiplier per GOZ number
npm run charges-from-plan -- <CarePlan id> --dry-run --out plan.json  # validate only, keep the Bundle
npm run cost-plan -- --aidbox dent-051                           # price it
```

| ChargeItem | From |
|---|---|
| `code` | the GOZ coding of `activity.detail.code`; refused unless the catalog has a `ChargeItemDefinition` for it |
| `bodysite` | the FDI tooth of the `detail.reasonReference` (an Observation or Condition with `bodySite`); none without a reasonReference |
| `quantity` | `detail.quantity`, else 1 |
| `factorOverride` | 2.3, or `--factor <GOZ>=<multiplier>` for every activity with that number |
| `occurrenceDateTime`, `subject` | `CarePlan.period.start`, `CarePlan.subject` |
| `account`, `supportingInformation` | the generated Account, the CarePlan |

The Account takes its name from the CarePlan title ("HKP ..." becomes "Kostenplan ..."), the
plan type from the CarePlan category, and the patient's only active `Coverage` (or
`--coverage <id>`); the owner is `Organization/fhir-camp-practice` (or `--owner <id>`).

Ids are stable: `<CarePlan id>-cost-plan` and `<CarePlan id>-charge-NN` (a CarePlan id longer than 53
characters is cut and gets a hash, to stay within the 64 characters of a FHIR id). Running it again
replaces the cost plan and deletes ChargeItems of that Account the plan no longer has. Every
resource passes `$validate` (base R4) before the write and again after it is read back.
Running it on a seeded CarePlan adds a second cost plan next to the seeded one; for
`dent-051-hkp-alt-a/-b/-c` (with `--factor 9010=3.0` for C) the totals and decisions match the
seeded plans. `npm --workspace billing test` checks the mapping against the seed offline.

## Line prices from `evaluateBillingAccount`

The CLI prints decisions only. For prices, call the SDK directly, as `cost-plan.mjs` does:

```js
import { bundleAdmissionRecords, createBundleFhirClient, evaluateBillingAccount } from '@cognovis/fhir-billing-sdk'

const bundles = [catalog, caseBundle]
const admissions = bundleAdmissionRecords(bundles, { tenant: 'standalone' })
const client = createBundleFhirClient([...bundles, { resourceType: 'Bundle', type: 'collection', entry: admissions.map((resource) => ({ resource })) }])
const result = await evaluateBillingAccount({ client, profiles, tenant: 'standalone', asOf: '2026-11-16', account: 'dent-051-cost-plan-a' })

for (const line of result.case.lines) {
  // line.unitPrice      { value, currency }: the single fee from the ChargeItemDefinition
  // line.actualMultiplier  ChargeItem.factorOverride
  // line.quantity, line.code, line.id (the ChargeItem id)
}
```

`profiles` maps each resource kind the SDK reads to a profile binding; `cost-plan.mjs` uses
base R4 bindings built with `defineProfile` from `@cognovis/fhir-sdk/client`.

The SDK does not multiply. The fee of a line is
`round(points x point value x multiplier, 2) x quantity`, with the points and point value
from the informational price components of the `ChargeItemDefinition`
(see `../catalog/README.md`).

## Profiles

The planned ChargeItems are plain FHIR R4 ChargeItems without a profile. The dental IG's
`goz-charge-item` profile requires the `taxCategory` extension from the billing package
`de.cognovis.fhir.billing`, which is not published yet. See the main README, "Known gaps".
