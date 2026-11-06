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
| `goz-5120-requires-5000-or-5010` | `companion-required` | GOZ 5120 requires at least one 5000 **or** 5010 in the same Account | invented for the exercise; issue #8 |

Each rule records its basis as `provenance.evidenceLevel`. After editing the payload, run
`npm run build-catalog`. To reload Aidbox, `npm run setup` overwrites seed resources with
fixed IDs; check for local edits first. The offline demo below needs no reload.

## Companion-rule demo (issue #8)

From the repository root, with the pinned dependencies installed:

```sh
npm run build-catalog
npm --workspace billing run check:companion
node billing/cost-plan.mjs --bundle billing/examples/companion-cost-plans.json --json
npm --workspace billing test
npm run billing:check
```

The fixture uses synthetic Greta Palmried (`Patient/dent-051`) and six independent
Accounts. Every fixture resource carries `HTEST`. Expected results:

| Account suffix (`example-companion-…`) | Codes | Decision |
|---|---|---|
| `missing` | 5120 | `block` |
| `5000` | 5120, 5000 | `allow` |
| `5010` | 5120, 5010 | `allow` |
| `no-5120` | 0030 | `allow` |
| `other-account` | 5120 | `block` |
| `donor` | 5000 | `allow` |

Both blocked cases report `COMPANION_CODE_REQUIRED`, rule
`goz-5120-requires-5000-or-5010`, and their own `…-5120` ChargeItem. The `donor`
Account's 5000 cannot satisfy another Account's requirement, even for the same patient.
The test asserts those exact findings, the generated Library and edition link, and the
unchanged A/B/C decisions and totals (549.26 / 428.44 / 673.59 EUR).

The installed rules/engine 0.40.0 use an OR search over `required.codes`. The SDK 0.42.1
selects ChargeItems per Account, so this rule deliberately has no `countingScope`.
This is an **invented hackathon rule**, not a generally applicable GOZ requirement;
the issue suggestion is its provenance, not a clinical or statutory authority.
`cost-plan.mjs --aidbox` still reads the catalog from the local file: changing only
the server's Library does not change that CLI's rules. The example bundle is not
imported by `npm run setup`, and `npm run validate` does not validate these fixtures.

What the rule classes cannot express today: a limit per tooth (the SDK counts per cost plan,
not per tooth), and the price of the six GOZ numbers that are a share of another number. See
`../TASKS.md`.

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
