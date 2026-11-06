---
name: fhir-ig-development
description: Write or change FHIR profiles, extensions, code systems and examples in FSH, build them with SUSHI and the IG Publisher, and test them against the dental packages in the local Aidbox. Use when a task needs a new profile, an extension, a value set, or a small Implementation Guide on top of the dental IGs.
---

# FHIR IG development

Build FHIR conformance artifacts that the installed packages actually accept, not just
artifacts that compile.

## What the kit gives you

- Two published packages, installed into Aidbox by `npm run setup`:
  - `de.cognovis.fhir.dental.core#0.10.2`: country-neutral tooth-state and chart
    contracts (https://fhir.cognovis.de/dental-core/0.10.2/)
  - `de.cognovis.fhir.dental#0.57.2`: the German dental profiles, including
    `dental-care-plan` (https://fhir.cognovis.de/dental/0.57.2/)
- The package tarballs are at `<guide URL>/package.tgz`. Their FSH sources are not public;
  read the StructureDefinitions in the package or the rendered guide.
- An Aidbox that validates against those profiles (`npm run validate`).

## Workflow

1. **Read the base first.** Before you profile a resource, read the StructureDefinition you
   build on: the rendered guide page, or the JSON in the package tarball. Treat a memory or
   a summary as a lead, not as the authority.
2. **Start a small FSH project next to the kit**, for example `ig/`, with a
   `sushi-config.yaml` that declares the dental packages as dependencies:

   ```yaml
   id: fhir-camp.example
   canonical: https://github.com/cognovis/fhir-camp-hackathon/ig
   fhirVersion: 4.0.1
   dependencies:
     de.cognovis.fhir.dental.core: 0.10.2
     de.cognovis.fhir.dental: 0.57.2
   ```

   SUSHI looks dependencies up in the public package registry, which does not carry these
   packages. Download the tarballs from the guide URLs and unpack each into
   `~/.fhir/packages/<id>#<version>/package/`. The dental package itself depends on two
   packages that are not published (`de.cognovis.fhir.billing`,
   `de.cognovis.terminology.dental.dpf-kuerzel`). If your profiles touch neither billing
   nor DPF abbreviations, depend on `de.cognovis.fhir.dental.core` only, or expect
   unresolved-dependency warnings. This route is not exercised in the kit; tell the others
   what worked.
3. **Use the simplest valid shape.** Profile only what you need. Rely on the constraints
   you inherit and do not copy them into the child profile for visibility. Each new
   constraint needs a reason.
4. **Order the changes by dependency:** code systems and value sets first, then
   extensions and profiles, then examples, then the narrative pages.
5. **Build.** Run `npx fsh-sushi build ig` for the conformance resources. Run the IG
   Publisher (`java -jar publisher.jar -ig ig -tx n/a`) only when you need the rendered
   guide; `-tx n/a` keeps it off remote terminology servers.
6. **Validate in Aidbox,** not just with SUSHI (see below).
7. **Report** what changed in the contract, what you validated, and what is still open.

## Validating your artifacts in the kit's Aidbox

- Install a package through the FHIR Artifact Registry:
  `POST /fhir/$fhir-package-install` with a `Parameters` resource whose `package`
  parameter is a URL or a `name#version` (see `scripts/setup.mjs`, `PACKAGES`). Only that
  route makes profiles and terminology resolvable for validation. A plain `PUT` of a
  StructureDefinition stores it but does not make it usable for `$validate`.
- Validate one resource against one explicit profile:
  `POST /fhir/<Type>/$validate?profile=<canonical>` with the resource as the body
  (`curl -u root:hackathon ...`). An `OperationOutcome` with no `error` or `fatal` issue
  passes.
- Validate the profile the resource claims in `meta.profile`. Do not switch Aidbox to
  strict validation for the whole instance to make a test pass; that changes the
  behaviour for every other team and still does not tell you which profile failed.
- `npm run validate` re-runs the kit's profile checks over every seeded resource.

## Do not

- Claim conformance from a clean SUSHI build. SUSHI checks syntax and references, not
  terminology bindings, slice cardinalities or required codings. Only `$validate` against
  the installed profile proves conformance.
- Put a local code system with the same codes into an extension whose value set binding
  is `required`. Same codes in a different system fail validation.
- Use real patient data in examples. Every example in this repository is synthetic.
- Copy text or codes from licensed terminologies (SNOMED CT, LOINC beyond its licence,
  KZBV or BZÄK publications) into an artifact unless you know the licence allows it.
- Publish anything to a package registry from the hackathon.

## Resources

| Resource | Purpose |
| --- | --- |
| FHIR Shorthand specification, https://build.fhir.org/ig/HL7/fhir-shorthand/ | FSH syntax and constraint behaviour |
| SUSHI, https://fshschool.org/docs/sushi/ | Building FSH |
| HL7 guidance for IG creation, https://build.fhir.org/ig/FHIR/ig-guidance/ | Dependencies, testing, publication |
| FSH Online, https://fshonline.fshschool.org/ | Try FSH in the browser |
| Aidbox validation docs, https://www.health-samurai.io/docs/aidbox | `$validate`, package install |
| `fhir-emission` skill | Writing resources that pass validation |
