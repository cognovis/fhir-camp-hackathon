# Synthetic patients

All people, practices and insurers here are invented. Every resource carries the meta tag
`HTEST` (test health data). The patients are adapted from the synthetic dental demo corpus
cognovis uses for its own tests.

`npm run setup` loads every `*.json` here into Aidbox, in file-name order, as transaction
Bundles, and validates each resource that names a `meta.profile` against that profile.

| File | Patient | What it shows |
|---|---|---|
| `00-practice.json` | | The practice (`Organization/fhir-camp-practice`), the dentist (`Practitioner/fhir-camp-dentist`) and a private insurer (`Organization/fhir-camp-insurer`) |
| `dent-051-palmried.json` | Greta Palmried, 1952 | **The complete chain**, in the planning stage (see below) |
| `dent-046-enning.json` | Karl Enning, 1947 | Chart with telescopic crowns; a chosen plan (telescopic denture, done) and an alternative |
| `dent-056-nissenried.json` | Amadou Nissenried, 1964 | Chart with an implant; a chosen plan (single implant with crown, done) and an alternative |
| `dent-057-luchter.json` | Karen Luchter, 1956 | Chart with fillings and crowns; a chosen plan (partial crown, done) and an alternative |

Each patient has:

- a panel `Observation` "Zahnbefund (Odontogramm)" whose `hasMember` lists the 32 teeth,
- 32 tooth-state `Observation`s (profile `dental-tooth-state` from dental core), one per FDI
  tooth position, with components for presence, substrate, restoration type and material and,
  for fillings, the surfaces,
- a finding `Observation` and a `Condition`,
- treatment alternatives as `CarePlan` (profile `dental-care-plan`).

## The complete chain: DENT-051

| Step | Resources |
|---|---|
| Findings | Chart of 2026-09-24: tooth 36 missing, 35 sound, 37 with a composite filling (mesial, occlusal). `Condition` "Einzelzahnlücke regio 36" |
| Treatment alternatives | `CarePlan/dent-051-hkp-alt-a` (bridge 35-37, veneered, `intent = plan`: the chosen one), `-b` (bridge, full cast, `intent = option`), `-c` (single implant 36 with crown, `intent = option`). All `status = draft`. Each activity carries the GOZ number in `detail.code` and points to the tooth in `detail.reasonReference` |
| Planned charges | 25 `ChargeItem`s (`status = planned`), `dent-051-alt-{a,b,c}-NN`: GOZ number, tooth (`bodysite`), multiplier (`factorOverride`), the CarePlan in `supportingInformation` |
| Cost plan per alternative | `Account/dent-051-cost-plan-a/-b/-c`, each linked to the private `Coverage` and its treatment `Contract` |
| Pre-authorization | Not seeded. That is a task (`../TASKS.md`) |

Prices and the billing check: see `../billing/README.md`.

## What was changed from the source corpus

- Only the resources the chain needs were kept. Encounters, Procedures and other resources the
  kit does not ship were dropped, and references to them removed. Performers and authors point
  to the one synthetic dentist.
- DENT-051 was moved back to the planning stage: in the source the bridge was already done.
  Its coverage was changed to a private insurance with a GOZ treatment contract, so the cost
  plan is priced from the GOZ only. No statutory subsidy (Festzuschuss) amounts and no BEL II
  or BEB lab prices appear anywhere in the data.
- CarePlan titles were rewritten for the exercise. The HKP plan-type coding carries no display,
  because the dental IG's code system has none and Aidbox rejects a different one.
- Identifiers use the system `https://github.com/cognovis/fhir-camp-hackathon/sid/patient`.

The planned `ChargeItem`s and the `Account`, `Coverage` and `Contract` resources have no
profile. Their German profiles need the billing package, which is not published yet (see the
main README, "Known gaps").
