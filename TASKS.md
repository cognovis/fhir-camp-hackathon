# Tasks

Pick one, put your name next to it on the board, and go. Each task stands on its own and
ends with something visible in Aidbox or on screen. Together they make the demo:
chart the findings, plan alternatives, compare them by cost, choose one, ask for
pre-authorization.

The example patient for every task is Greta Palmried (`Patient/dent-051`): tooth 36 is
missing, the plan is a bridge 35-37 or an implant. See `data/README.md`.

Size: **S** fits in an hour or two, **M** half a day, **L** the whole day.

---

## 1. Chart to FHIR: write findings back from the odontogram (M)

Today the starter app only reads the chart. Make it write: when a tooth is changed in the
odontogram, save it as a dental-core tooth-state `Observation` in Aidbox.

- Start: `app/src/odontogram/chartAdapter.ts` maps FHIR to the chart (`toToothRecord`).
  Write the inverse, from the upstream tooth record to the Observation components
  (`tooth-presence`, `restoration-type`, `restoration-material`, surfaces as the
  `tooth-surface` extension).
- Listen with `onStateChange` and read the chart with `getStatusChart()` from
  `react-advanced-odontogram`; switch off `readOnly` in `OdontogramView.tsx`.
- Write a new Observation per changed tooth (new `effectiveDateTime`) rather than overwriting:
  the old chart is history.
- Done when: you mark tooth 46 as missing in the app, reload, and it is still missing; the new
  Observation passes `$validate` against `dental-tooth-state`
  (`POST /fhir/Observation/$validate?profile=https://fhir.cognovis.de/dental-core/StructureDefinition/dental-tooth-state`).
  `npm run validate` checks only the seeded resources, not the ones you create.

## 2. Plan alternatives: create and choose a treatment alternative (M)

Build the step from finding to plan. From a finding ("tooth 36 missing"), create a new
treatment alternative as a `CarePlan`, and let the user choose one.

- A new alternative is a `CarePlan` with profile `dental-care-plan`, `status = draft`,
  `intent = option`, and one `activity` per planned service: GOZ number in `detail.code`,
  the tooth's Observation in `detail.reasonReference`. Copy the shape from
  `CarePlan/dent-051-hkp-alt-b`.
- Choosing an alternative sets its `intent` to `plan` and the others back to `option`.
  Decide what happens to the chosen plan's `status` (`draft` -> `active` once the patient
  agrees?) and write the decision down.
- The app already draws the planned chart of a selected CarePlan (`toPlanChart`); extend
  `PLANNED_EFFECT` for the GOZ numbers you use.
- Done when: a fourth alternative for DENT-051 (for example a removable partial denture) shows
  up in the app with its planned chart, and choosing it is visible in Aidbox.

## 3. Charges from plan activities (S to M)

Generate the planned `ChargeItem`s of a cost plan from a CarePlan's activities, instead of
writing them by hand as the seed data does.

- Input: a CarePlan. Output: one `Account` (the cost plan) and one `ChargeItem` per activity
  with `status = planned`, `code` = the GOZ number, `bodysite` = the tooth of the
  `reasonReference`, `factorOverride` = 2.3 by default, `account` and
  `supportingInformation` (the CarePlan). Copy the shape from `dent-051-alt-a-04`.
- Look the GOZ number up in the catalog (`ChargeItemDefinition?code=...`) and refuse unknown
  numbers.
- Run it for the alternative from task 2 and check it with
  `node billing/cost-plan.mjs --aidbox dent-051`.
- Done when: the generated ChargeItems for `dent-051-hkp-alt-a` match the seeded ones, and the
  billing check gives the same decision.

## 4. Rules as FHIR: write a new billing rule (S to M)

The rule set is a FHIR `Library` (`billing/goz-hackathon-rules.json`, wrapped by
`npm run build-catalog`). Add a rule and show it firing.

- Ideas: GOZ 0090 (anaesthesia) at most N times per cost plan; GOZ 5120 (temporary bridge,
  per tooth) only together with 5010 or 5000 on the same plan; a mutual exclusion you find in
  the GOZ text (`catalog/source`, field `description`).
- The rule classes and their required parameters are listed in
  `BILLING_RULE_CLASS_DEFINITIONS` of `@cognovis/fhir-billing-rules` (for example
  `quantity-limit`, `mutual-exclusion`, `companion-required`, `bounded-multiplier`,
  `value-limit`). The three existing rules show the payload shape.
- Harder: a limit per tooth ("GOZ 2200 at most once per tooth per plan") cannot be expressed
  with today's classes, which count per cost plan. Write down what the rule would need, as a
  FHIR shape, and show it with a small check of your own next to the SDK.
- Done when: a new example bundle (like `billing/examples/blocked-cost-plan.json`) breaks your
  rule and `fhir-billing-check` reports it.

## 5. Cost plan view in the app (M)

Show what each alternative costs, side by side, so the patient can choose.

- `billing/cost-plan.mjs` already prices every cost plan of a patient with the Billing SDK
  (`evaluateBillingAccount`; see `billing/README.md`, "Line prices"). Make those numbers
  visible in the app: per alternative the lines (GOZ number, tooth, multiplier, fee), the
  total and the billing decision with its findings.
- Two routes: add a tiny local endpoint next to Vite that runs
  `cost-plan.mjs --aidbox <id> --json` (works today), or try running the SDK in the browser
  (not tested in this kit).
- Show the finding on alternative C ("multiplier 3.0 needs a justification") and let the user
  add the justification text (`ChargeItem.reason`), then re-check.
- Done when: the three alternatives of DENT-051 show 549.26, 428.44 and 673.59 EUR, and
  alternative C turns from "needs review" to "allow" after a justification.

## 6. Pre-authorization: Claim and ClaimResponse (M)

Send the chosen alternative to the insurer as a pre-authorization and record the answer.

- Build a `Claim` with `use = preauthorization` from the chosen CarePlan's cost plan:
  `patient`, `insurer` (`Organization/fhir-camp-insurer`), `provider` (the practice),
  `insurance` (the Coverage), one `item` per planned ChargeItem with `productOrService`
  (GOZ), `bodySite`, `quantity`, `factor` and `net` from the cost plan.
- Play the insurer: write a `ClaimResponse` (`outcome`, `preAuthRef`, per item an
  `adjudication`, for example "approved" or "reduced"), and show the answer next to the plan.
- Optional: use Aidbox's `$submit` or a simple Subscription to simulate the round trip.
- Done when: Aidbox holds a Claim and a ClaimResponse for DENT-051, the Claim's total equals
  the cost plan total, and the app shows the insurer's answer.

## 7. The demo path (S, at the end)

Put tasks 1 to 6 into one click path for the five-minute demo, and write the script:
chart -> plan alternatives -> cost comparison -> choose -> pre-authorization, with the FHIR
resources visible in the Aidbox UI at each step.

---

## Known limits you may run into

- The planned ChargeItems carry no German profile: the dental IG's `goz-charge-item`
  profile needs the unpublished billing package (README, "Known gaps").
- GOZ numbers that are a share of another number (0120, 2230, 2240, 5050, 5060, 5240) have
  no price in the catalog.
- The catalog and the rules are generated for the hackathon and are not billing-grade.
