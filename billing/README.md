# Source-based GOZ checks

These checks cover the twelve GOZ codes in Greta Palmried's alternatives, plus the
counter-codes needed for their exclusions. They are a bounded demonstration, not a
complete clinical, legal, invoice or insurance assessment. Clinical conclusions and
agreement validity must be supported by explicit evidence; they are not inferred from
a fee number or arbitrary text. All example resources are synthetic and carry `HTEST`.

## Run the complete check

From the repository root, with the pinned dependencies installed:

```sh
npm run build-catalog
npm run billing:check
npm run billing:check:blocked
node billing/check-goz.mjs --bundle billing/examples/goz-real-valid.json
node billing/cost-plan.mjs --bundle billing/examples/goz-real-valid.json --json
npm --workspace billing test
npm --workspace app run typecheck
```

- `goz-real-valid.json`: explicit synthetic evidence for all twelve codes; `allow`.
- `goz-real-invalid.json`: a 5010 on an implant; `block`, rule
  `goz-5010-supportKind`, finding `ACCOMPANYING_INFORMATION_REQUIRED` on
  `goz-real-invalid-5010`.
- `goz-real-agreement.json`: explicit prior individual agreement for 0030 at factor 4; `allow`.
- Original A/B/C: `unavailable` because the additional clinical evidence is absent.
  Their calculated fees remain **549.26 / 428.44 / 673.59 EUR**.
- `companion-cost-plans.json` and `blocked-cost-plan.json` are older test inputs.
  The invented 5120-companion and 0030-quantity rules are no longer loaded; these
  files are not authoritative examples of real GOZ restrictions. The former
  `check:companion` command now uses the complete evaluator on that legacy input.

`allow` means the covered checks found no problem on the supplied evidence. It does
not certify all German billing rules. `block` requires a demonstrated violation;
missing, conflicting or incomplete evidence produces `unavailable` (review required).
Rule IDs, affected lines, source links and explanations are included in JSON output.

## Where the rules live

| Editable source | Generated FHIR carrier | Evaluator |
|---|---|---|
| `goz-hackathon-rules.json` | `Library/goz-hackathon-rules` | Pinned Billing SDK: 5010 requires a natural tooth, 9040 a two-phase implant system |
| `goz-context-rules.json` | `Library/goz-context-rules` | Local, bounded contextual checks in `goz-context.mjs` |

Both Libraries are in `../catalog/goz-catalog.bundle.json`. The native catalog edition
still references the native rule-set Library. The additional Library has a separate
artifact-kind, an exact edition/version dependency and the edition digest. Its payload
is canonical JSON in one Base64 attachment with its own SHA-256. Missing, corrupt,
duplicate or mismatched contextual Libraries withhold the overall result.

`evaluate-goz.mjs` combines `evaluateBillingAccount` with those additional checks.
A native rejection is never weakened. The installed native `fhir-billing-check` CLI
alone **does not execute the additional Library**. Use the commands above for the
complete demo. No npm dependency or Core source change is required.

## Covered rules and sources

The rule JSON contains a citation and source URL for every rule. The reviewed source
snapshot is **2026-11-06**; the deliberately bounded demonstration evaluation window
is **2026-11-06 through 2026-11-16**, inclusive. This window is an implementation review
boundary, not the effective lifetime of the legislation. Dates outside it require a
source review and produce `GOZ_LEGAL_SNAPSHOT_UNREVIEWED`.

| Scope | Check | Primary source |
|---|---|---|
| All twelve codes | Statutory fee range, individual agreement exceptions and factor/amount consistency | GOZ §§ 2, 5 |
| All twelve codes | Individual justification above 2.3, with the distinct § 2 agreement case | GOZ § 5(2), § 10(3) |
| All twelve codes | Exact points × point value × factor; round only the resulting unit fee | GOZ § 5(1) |
| All twelve codes | Confirmed own/complete service or planned content, indication or documented requested treatment | GOZ §§ 1(2), 2(3), 4(2) |
| 0030 | Findings and written plan; exclusion of 0040 for the same planning subject | Anlage 1 A, 0030/0040 |
| 0090 | Sum split positions for the same tooth/target and session; repeated use needs its own justification | Anlage 1 A, note at 0100 |
| 2200 | Exclusion of 2050–2130 in the same restoration context; included component services | Anlage 1 C, notes at 2220 |
| 5000/5010 | Anchor identities, included component services; 5010 not on implants | Anlage 1 F, notes at 5040 |
| 5070 | Explicit span/free-end identities and quantities | Anlage 1 F, 5070 |
| 5120/5140 | Direct manufacture with impression, correct units, included reinsertion/removal of the same already billed provisional | Anlage 1 F, 5120/5140 |
| 9000/9003 | Jaw identities, documented implant analysis / actual use of orientation template | Anlage 1 K, 9000/9003 |
| 9010 | Implant/insertion identities and included component services | Anlage 1 K, 9010 and general provision 1 |
| 9040 | Two-phase system, exposure and insertion of abutment elements | Anlage 1 K, 9040 |
| 9050 counter-code | Same-implant/session exclusion with 9010/9040; at most once/session and three times/reconstructive phase | Anlage 1 K, 9050 |

Official texts: [GOZ Anlage 1](https://www.gesetze-im-internet.de/goz_1987/anlage_1.html),
[§ 2](https://www.gesetze-im-internet.de/goz_1987/__2.html),
[§ 4](https://www.gesetze-im-internet.de/goz_1987/__4.html),
[§ 5](https://www.gesetze-im-internet.de/goz_1987/__5.html),
[§ 10](https://www.gesetze-im-internet.de/goz_1987/__10.html).
BZÄK commentary on 0030, 0090, 5120 and 9050 is identified separately in provenance
as interpretation, not legislation. A replacement provisional after loss/defect is
not the same event as reinsertion. Other-provider and analog situations require
individual review; the evaluator does not choose an analog fee number.

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

## Evidence supplied as FHIR

The working examples show the full shape. Each ChargeItem references Observations in
`supportingInformation`; the code system is
`https://github.com/cognovis/fhir-camp-hackathon/CodeSystem/goz-evidence`.
Accepted Observations are final/amended/corrected, name the same patient, have an
`effectiveDateTime` and a `performer` or `derivedFrom` source. Conflicting statements
remain unknown. The examples explicitly state synthetic evidence; they do not amend
Greta's original clinical history.

- Text/identity facts use `valueString`: `episodeId`, `eventId`, `targetId`,
  `planningObjectId`, `restorationId`, `provisionalId`, `implantId`, `phaseId`,
  `unitKind`, `supportKind`, `implantSystem`, `phase`, `indication` and event actions.
- Confirmed facts use `valueBoolean`, including `scopeComplete`, `historyComplete`,
  `ownServiceConfirmed`, `contentConfirmed`, `justificationConfirmed` and
  `repeatJustificationConfirmed`. False is distinct from missing.
- `unitIds` uses one `component` per unit, each coded `unitId` with a `valueString`.
  A descriptive parent `valueString` also keeps these Observations readable by the
  native SDK; the contextual evaluator uses the components, not that description.
- Fee facts (`agreementFactor`, `agreementFee`, `claimedUnitFee`) use a decimal
  `valueString`. The latter two are EUR. The explicit representation preserves
  compatibility with the pinned SDK's primitive Observation reader.
- Session identity comes from `ChargeItem.context` referencing a same-patient
  `Encounter`. An optional `sessionId` assertion must agree. A calendar day is not
  automatically a session. Two implants or provisionals at one tooth need different IDs.
- Agreement evidence includes `agreementStatus` (`none`, `valid`, `invalid`), a
  same-patient current `DocumentReference`, `agreementSignedAt`, matching factor/fee
  and `agreementConfirmed`. Same-day timing needs time-of-day evidence. Validity and
  clinical appropriateness require a responsible person's assessment, not this code.

The contextual evaluator needs a complete explicitly confirmed scope to establish
absence or aggregate quantities. Billed history of the same episode/object can count
for 9050; parallel *planned* alternative Accounts cannot. `includedIn` explicitly
links a separately charged component to its parent ChargeItem. It does not infer
that an independent service is included merely because its code looks related.

## Aidbox and verification boundaries

```sh
npm run cost-plan -- --aidbox dent-051 --json
```

This reads cases and linked evidence from local Aidbox, including paginated searches,
while **both rule Libraries still come from the local catalog file**. The graph loader
rejects incomplete/cyclic searches and external pagination URLs. It supports loopback addresses and the local Compose service name `aidbox`. Missing referenced
evidence leads to review. It does not write data.

`npm run setup` loads the catalog and ordinary data, then the three real-GOZ example
bundles (valid, invalid, individual agreement). Their IDs are disjoint. The example
Patient entry is skipped so it cannot replace Greta's full `data/` Patient resource.
Old artificial examples are not part of the seed.

```sh
node scripts/setup.mjs --check-seed  # offline: distinct IDs, complete references, full Patient
npm run setup                      # reload declared seeds; first preserve any local seed edits
npm run validate                   # existing profiles and example/Library base-R4 checks
```

The current seed contains 561 unique resources. Validation runs 141 existing profile
checks and 159 base-R4 checks (156 example resources and three Libraries). Re-running
setup overwrites the declared seed IDs; it does not reset the database or remove other
resources. Check local edits before reloading. The original A/B/C data remain present
and intentionally lack the new clinical evidence.
