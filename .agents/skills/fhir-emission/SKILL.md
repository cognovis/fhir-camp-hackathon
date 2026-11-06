---
name: fhir-emission
description: Map application data (chart state, plans, charges, claims) to FHIR resources that pass validation against the installed profiles, and diagnose validation failures. Use when code writes Observations, CarePlans, ChargeItems, Claims or other resources to Aidbox.
---

# FHIR emission

Write FHIR that the installed StructureDefinitions actually accept, not just resources that
typecheck.

## The rules

1. **A green build is not conformance.** Unit tests check shape and `tsc` checks types.
   Neither checks terminology bindings, slice cardinalities or required codings. Only
   `$validate` against the installed profile does.
2. **Read the profile, not a summary of it.** The constraints live in the installed
   StructureDefinition: the rendered guide page or the JSON in the package. Generated
   types and helpers check required fields at most.
3. **Validate every new shape.** When code starts writing a resource type, or changes a
   `meta.profile`, a `Coding.system` or a binding, round-trip one example: write it, read
   it back, `POST /fhir/<Type>/$validate?profile=<canonical>`, and require that no issue
   has severity `error` or `fatal`.
4. **The extension binding trap.** A `Coding` inside an extension must use the code system
   the extension's `required` binding demands, not a local code system with the same
   codes.
5. **Copy the shape of a seeded resource that already validates.** The seed data passes
   `npm run validate`; start from it:

   | You write | Copy from |
   | --- | --- |
   | Tooth state (chart) | any `dent-051-obs-tooth-chart-NN` Observation, profile `dental-tooth-state` |
   | Treatment alternative | `CarePlan/dent-051-hkp-alt-b`, profile `dental-care-plan` |
   | Planned charge | `ChargeItem/dent-051-alt-a-04` (no profile, see below) |
   | Cost plan | `Account/dent-051-cost-plan-a` |

6. **History, not overwrite.** A changed chart is a new tooth-state Observation with a new
   `effectiveDateTime`; the old one stays as history.
7. **Mark test data.** Every resource in this kit carries the meta tag `HTEST`; keep doing
   that for the resources you create.

## Known limits in this kit

- `ChargeItem`, `Account`, `Coverage` and `Contract` have no profile here: their German
  profiles need the billing package `de.cognovis.fhir.billing`, which is not published
  yet. Validate them against base R4 only.
- The dental package is installed without two unpublished dependencies (the billing
  package and the DPF abbreviation terminology). Profiles that need them cannot be
  validated; see `scripts/setup.mjs` and the main README, "Known gaps".

## Do not

- Claim "it validates" from green tests or a typecheck.
- Drop or coarsen clinical data to make a resource fit a too-small value set. Report the
  gap instead.
- Log a full `OperationOutcome` from a real system: it can carry patient data. In this kit
  all data is synthetic, so printing it while you debug is fine.
