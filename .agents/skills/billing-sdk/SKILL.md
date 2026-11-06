---
name: billing-sdk
description: Check and price dental cost plans with the cognovis Billing SDK (@cognovis/fhir-billing-sdk), write billing rules as FHIR, and use @cognovis/fhir-sdk next to it. Use when a task touches the billing check, the cost plan prices, the rule set, or a new rule.
---

# Billing SDK in the kit

The cognovis Billing SDK (Apache-2.0) evaluates billing rules over FHIR resources: planned
`ChargeItem`s, the catalog of `ChargeItemDefinition`s and a rule set carried as a `Library`.
It runs offline on FHIR bundles; no server is needed.

Packages, pinned in `billing/package.json` and served from https://npm.cognovis.de without a
login (`.npmrc` sets the `@cognovis` scope):

| Package | Version | Use here |
| --- | --- | --- |
| `@cognovis/fhir-billing-sdk` | 0.42.1 | `fhir-billing-check` CLI, `evaluateBillingAccount` |
| `@cognovis/fhir-billing-rules` | 0.40.0 | `BILLING_RULE_CLASS_DEFINITIONS`, the rule classes |
| `@cognovis/fhir-sdk` | 0.23.3 | `defineProfile` for the profile bindings |

Source of the billing engine: https://github.com/cognovis/fhir-billing-core (public).
Keep these versions; the kit is tested with exactly them. `fhir-billing-sdk` 0.42.1 requires
engine, rules and types `^0.40.0` (so 0.40.x, not 0.41) and accepts `fhir-sdk` `^0.23.3`,
not 0.24. Do not add rules, engine or types 0.41 next to it: the SDK keeps using 0.40, and
rule classes read from 0.41 may not match what it checks. The registry's `latest` tag of
`fhir-billing-sdk` still points to 0.37.1, so an unpinned install gets the older SDK. The
packages are not on npmjs.org.

## Run it

```sh
npm run billing:check            # decision per cost plan of dent-051
npm run billing:check:blocked    # billing/examples/blocked-cost-plan.json breaks all three rules
npm run cost-plan                # line prices and totals per alternative
npm run cost-plan -- --aidbox dent-051 --json   # read from the local Aidbox, machine-readable
```

Expected: A and B `allow`, C `unavailable` (`MULTIPLIER_JUSTIFICATION_REQUIRED`, needs
review), blocked example `block`. Totals 549.26, 428.44 and 673.59 EUR. If you get anything
else, your change caused it.

`fhir-billing-check --help` lists the modes: `evaluate --bundle ... --as-of <date>` for FHIR
bundles, `evaluate --rule-set <file> --cases <file>` for bare cases, and `compare` for two
result files. Exit code 2 means a usage or input error.

## What a case needs

One cost plan is one `Account`:

- `Account.coverage` -> `Coverage`, `Coverage.contract` -> `Contract` (`status = executed`,
  with a `url`),
- the `ChargeItem`s whose `account` points to the Account, `status = planned`, GOZ number
  in `code`, tooth in `bodysite`, multiplier in `factorOverride`, justification for a
  multiplier above 2.3 in `reason[].text`,
- the catalog edition `Library`, its `ChargeItemDefinition`s and the rule-set `Library`, all
  in `catalog/goz-catalog.bundle.json`.

`billing/README.md` has the details, and `data/dent-051-palmried.json` a working example.

## Calling the SDK from code

The CLI prints decisions only. For prices and findings per line, call the SDK as
`billing/cost-plan.mjs` does: `bundleAdmissionRecords` + `createBundleFhirClient` over the
bundles, then `evaluateBillingAccount({ client, profiles, tenant: 'standalone', asOf,
account })`. `result.case.lines[]` carries `id` (the ChargeItem), `code`, `quantity`,
`unitPrice` and `actualMultiplier`.

- `profiles` maps every resource kind the SDK reads to a binding. The kit uses base R4
  bindings made with `defineProfile` from `@cognovis/fhir-sdk/client`; copy that block.
- The SDK does not multiply. Fee per line =
  `round(points x point value x multiplier, 2) x quantity`, with points and point value
  from the informational price components of the `ChargeItemDefinition`.
- In the browser: not tested in this kit. The proven route is a small local endpoint that
  runs `cost-plan.mjs --json`.

## Writing a rule

1. Edit `billing/goz-hackathon-rules.json`. Copy one of the three rules; each needs `id`,
   `class`, `effect`, `priority`, the class's required `parameters`, and `provenance`
   (a source citation and an evidence level; say honestly when a rule is invented).
2. Pick a class and its required parameters from the SDK, never from memory:

   ```sh
   node -e "import('@cognovis/fhir-billing-rules').then(m => console.log(m.BILLING_RULE_CLASS_DEFINITIONS))"
   ```

   Common ones: `quantity-limit` (`selector`, `maximum`), `mutual-exclusion` (`selector`,
   `excluded`), `companion-required` (`selector`, `required`), `bounded-multiplier`
   (`selector`, `minimum`), `value-limit` (`selector`, `maximum`).
3. `npm run build-catalog` wraps the payload into the rule-set `Library` inside
   `catalog/goz-catalog.bundle.json`. Then `npm run setup` reloads Aidbox.
4. Prove it: add an example bundle that breaks the rule (copy
   `billing/examples/blocked-cost-plan.json`) and show `fhir-billing-check` reporting it.
   Also run `npm run billing:check` to show the existing plans still pass.

What today's classes cannot express: a limit per tooth (counting is per cost plan), and
the six GOZ numbers priced as a share of another number. Write such a gap down as a
proposal (FHIR shape plus a small check of your own); do not fake it with another class.

## @cognovis/fhir-sdk beyond the billing check

`@cognovis/fhir-sdk` is the profile-bound TypeScript client for the cognovis guides. Its
README in `node_modules/@cognovis/fhir-sdk/README.md` documents it; the parts that fit the
hackathon:

- `@cognovis/fhir-sdk/dental` builders such as `buildOdontogramObservation` and
  `buildDentalCondition` return plain resources with `meta.profile` set.
- `@cognovis/fhir-sdk/dental-core` exports the Dental Core profile classes, for example
  `DentalToothStateProfile`.
- `createAidboxFhirClient({ baseUrl, clientId, clientSecret, writeSource })` from
  `@cognovis/fhir-sdk/client` is its Aidbox client; `baseUrl` is the Aidbox root, not
  `/fhir`.

None of these is exercised in the kit yet: the starter app talks to Aidbox with plain
`fetch` through the Vite proxy (`app/src/fhir.ts`), and the builders target the published
package versions the SDK pins, which may be newer than the ones in the kit's Aidbox.
Validate whatever they produce with `$validate` before you rely on it (see the
`fhir-emission` skill).

## Do not

- Present a price or a decision from this kit as billing-grade. Catalog and rules are
  generated for the hackathon.
- Add real KZBV Festzuschuss, BEL II or BEB values, or anything from a licensed source.
- Change the pinned SDK versions during the day without telling the others.
