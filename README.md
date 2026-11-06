# From tooth chart to bill: a dental treatment and cost plan on FHIR

A FHIR Camp hackathon project. One team, one day, one live demo.

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
| React Advanced Odontogram by Zoltán Dul (MIT), the upstream project | https://github.com/ZoliQua/React-Odontogram-Modul |

### Fee catalog

| Resource | Link |
|---|---|
| GOZ, the German dental fee schedule (statutory text) | https://www.gesetze-im-internet.de/goz_1987/ |

### Aidbox

| Resource | Link |
|---|---|
| Aidbox, free dev instance or local Docker | https://aidbox.app |
| Aidbox documentation | https://www.health-samurai.io/docs/aidbox |

## Coming before the camp

- The cognovis fork of the odontogram with FHIR mapping, bridges and plan
  alternatives (MIT)
- A Docker Compose setup: Aidbox with the dental and billing packages and a few
  synthetic dental patients, including a complete example from findings to
  planned charges
- The GOZ fee catalog as FHIR `ChargeItemDefinition` resources
- A starter app showing the odontogram on FHIR data from the local Aidbox
- A short list of ready-to-pick tasks

## License

Everything in this repository is licensed under the MIT License (see
[LICENSE](LICENSE)). Linked projects keep their own licenses.
