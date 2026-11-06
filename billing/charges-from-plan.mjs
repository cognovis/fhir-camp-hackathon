#!/usr/bin/env node
// Charges from plan activities: generates the cost plan of one treatment alternative, one
// `Account` and one planned `ChargeItem` per CarePlan activity, in the shape of the seeded
// `Account/dent-051-cost-plan-a` and `ChargeItem/dent-051-alt-a-04`.
//
// Per activity: `code` = the GOZ number of `detail.code` (refused unless the catalog has a
// ChargeItemDefinition for it), `bodysite` = the tooth of `detail.reasonReference`,
// `quantity` = `detail.quantity` or 1, `factorOverride` = 2.3 unless overridden per GOZ
// number, `account` = the new Account, `supportingInformation` = the CarePlan.
//
// Usage:
//   node charges-from-plan.mjs <CarePlan id>              generate and write to the local Aidbox
//     --factor <GOZ>=<multiplier>   multiplier for every activity with that GOZ number
//                                   (repeatable; default 2.3)
//     --coverage <Coverage id>      when the patient has more than one active Coverage
//     --owner <Organization id>     default fhir-camp-practice
//     --dry-run                     validate only, write nothing
//     --out <file>                  also write the transaction Bundle to a file
//
// Ids are stable: `<CarePlan id>-cost-plan` and `<CarePlan id>-charge-NN`. Running it again
// replaces the cost plan and deletes ChargeItems of that Account the plan no longer has.
//
// Generated for the hackathon, not a billing-grade calculation.

import { existsSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const GOZ_SYSTEM = 'http://fhir.de/CodeSystem/bzaek/goz'
export const TOOTH_SYSTEM = 'https://fhir.cognovis.de/dental-core/CodeSystem/tooth-position-fdi'
export const PLAN_TYPE_SYSTEM = 'https://fhir.cognovis.de/dental/CodeSystem/dental-care-plan-type'
export const DEFAULT_FACTOR = 2.3
const HTEST = { system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'HTEST', display: 'test health data' }

export const accountIdFor = (carePlanId) => `${carePlanId}-cost-plan`
export const chargeItemIdFor = (carePlanId, index) => `${carePlanId}-charge-${String(index + 1).padStart(2, '0')}`

const gozCoding = (activity) => activity.detail?.code?.coding?.find((c) => c.system === GOZ_SYSTEM && c.code)

// The FDI tooth position of a resource: Observation.bodySite or Condition.bodySite[].
const toothOf = (resource) => [resource?.bodySite ?? []].flat()
  .flatMap((site) => site.coding ?? []).find((c) => c.system === TOOTH_SYSTEM)?.code

/**
 * Builds the cost plan of one CarePlan. Pure: everything it reads comes in as arguments.
 *
 * @param {object} input
 * @param {object} input.carePlan        the CarePlan (treatment alternative)
 * @param {(code: string) => object | undefined} input.definitionFor  GOZ number -> ChargeItemDefinition
 * @param {(reference: string) => object | undefined} input.resolve   'Type/id' -> resource
 * @param {{ reference: string }} input.coverage   the patient's Coverage for the Account
 * @param {{ reference: string }} input.owner      the practice that owns the Account
 * @param {Record<string, number>} [input.factors] multiplier per GOZ number, default 2.3
 * @returns {{ account: object, chargeItems: object[] }}
 */
export function buildCostPlan({ carePlan, definitionFor, resolve, coverage, owner, factors = {} }) {
  if (carePlan?.resourceType !== 'CarePlan' || !carePlan.id) throw new Error('Input is not a stored CarePlan (resourceType CarePlan with an id).')
  const where = `CarePlan/${carePlan.id}`
  if (!carePlan.subject?.reference) throw new Error(`${where} has no subject.`)
  const date = carePlan.period?.start
  if (!date) throw new Error(`${where} has no period.start; it dates the cost plan.`)
  const activities = carePlan.activity ?? []
  if (activities.length === 0) throw new Error(`${where} has no activities.`)

  const codes = activities.map((activity, i) => {
    const coding = gozCoding(activity)
    if (!coding) throw new Error(`${where}, activity ${i + 1}: no GOZ number in detail.code (system ${GOZ_SYSTEM}).`)
    return coding.code
  })
  for (const code of Object.keys(factors)) {
    if (!codes.includes(code)) throw new Error(`--factor ${code}: GOZ ${code} is not in ${where}.`)
  }

  const accountId = accountIdFor(carePlan.id)
  const planType = (carePlan.category ?? []).flatMap((c) => c.coding ?? []).find((c) => c.system === PLAN_TYPE_SYSTEM)
  const account = {
    resourceType: 'Account',
    id: accountId,
    meta: { tag: [HTEST] },
    status: 'active',
    ...(planType && { type: { coding: [planType] } }),
    name: carePlan.title ? carePlan.title.replace(/^HKP\b\s*/, 'Kostenplan ') : `Kostenplan zu ${where}`,
    subject: [carePlan.subject],
    servicePeriod: { start: date },
    coverage: [{ coverage, priority: 1 }],
    owner,
    description: `Geplante GOZ-Leistungen zu ${where}`,
  }

  const chargeItems = activities.map((activity, i) => {
    const code = codes[i]
    const definition = definitionFor(code)
    if (!definition) throw new Error(`${where}, activity ${i + 1}: GOZ ${code} is not in the catalog (no ChargeItemDefinition).`)
    const catalogCoding = definition.code.coding.find((c) => c.system === GOZ_SYSTEM && c.code === code)
    const display = gozCoding(activity).display ?? catalogCoding?.display
    const teeth = [...new Set((activity.detail.reasonReference ?? []).map(({ reference }) => {
      const tooth = toothOf(resolve(reference))
      if (!tooth) throw new Error(`${where}, activity ${i + 1}: ${reference} does not resolve to a resource with an FDI tooth position.`)
      return tooth
    }))]
    if (teeth.length > 1) throw new Error(`${where}, activity ${i + 1}: reasonReference names more than one tooth (${teeth.join(', ')}); plan one activity per tooth.`)
    return {
      resourceType: 'ChargeItem',
      id: chargeItemIdFor(carePlan.id, i),
      meta: { tag: [HTEST] },
      status: 'planned',
      code: {
        coding: [{ system: GOZ_SYSTEM, code, ...(display && { display }) }],
        text: activity.detail.code.text ?? `GOZ ${code}${display ? ` ${display}` : ''}`,
      },
      subject: carePlan.subject,
      occurrenceDateTime: date,
      quantity: { value: activity.detail.quantity?.value ?? 1 },
      ...(teeth.length && { bodysite: [{ coding: [{ system: TOOTH_SYSTEM, code: teeth[0] }], text: `Zahn ${teeth[0]}` }] }),
      factorOverride: factors[code] ?? DEFAULT_FACTOR,
      account: [{ reference: `Account/${accountId}` }],
      supportingInformation: [{ reference: where }],
    }
  })

  return { account, chargeItems }
}

// --- Command line: read the inputs from the local Aidbox, validate, write. ---

function parseArgs(argv) {
  const options = { factors: {}, owner: 'fhir-camp-practice', dryRun: false }
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      const next = argv[++i]
      if (next === undefined) throw new Error(`${arg} needs a value.`)
      return next
    }
    if (arg === '--factor') {
      const [code, factor] = value().split('=')
      const number = Number(factor)
      if (!code || !Number.isFinite(number) || number <= 0) throw new Error(`--factor expects <GOZ>=<multiplier>, for example 9010=3.0.`)
      options.factors[code] = number
    } else if (arg === '--coverage') options.coverage = value()
    else if (arg === '--owner') options.owner = value()
    else if (arg === '--out') options.out = value()
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}.`)
    else positional.push(arg)
  }
  if (positional.length !== 1) throw new Error('Usage: node charges-from-plan.mjs <CarePlan id> [--factor <GOZ>=<multiplier>] [--coverage <id>] [--owner <id>] [--dry-run] [--out <file>]')
  options.carePlanId = positional[0].replace(/^CarePlan\//, '')
  return options
}

function aidbox() {
  const url = (process.env.AIDBOX_URL ?? `http://localhost:${process.env.AIDBOX_PORT ?? '8080'}`).replace(/\/$/, '')
  const authorization = `Basic ${Buffer.from(`${process.env.AIDBOX_CLIENT ?? 'root'}:${process.env.AIDBOX_SECRET ?? 'hackathon'}`).toString('base64')}`
  const request = async (method, path, body) => {
    const response = await fetch(`${url}/fhir/${path}`, {
      method,
      headers: { authorization, accept: 'application/fhir+json', ...(body && { 'content-type': 'application/fhir+json' }) },
      ...(body && { body: JSON.stringify(body) }),
    })
    const json = await response.json().catch(() => undefined)
    return { status: response.status, ok: response.ok, json }
  }
  const fail = (path, status, json) => new Error(`GET ${path}: HTTP ${status} ${json?.issue?.map((i) => i.diagnostics).join('; ') ?? ''}`.trim())
  // Read one resource by 'Type/id'; undefined when it does not exist.
  const read = async (path) => {
    const { ok, status, json } = await request('GET', path)
    if (status === 404 || status === 410) return undefined
    if (!ok) throw fail(path, status, json)
    return json
  }
  // Search, following the `next` links; every error is an error, never an empty result.
  const search = async (query) => {
    const resources = []
    for (let path = query; path;) {
      const { ok, status, json } = await request('GET', path)
      if (!ok || json?.resourceType !== 'Bundle') throw fail(path, status, json)
      resources.push(...(json.entry ?? []).map((e) => e.resource))
      const next = json.link?.find((l) => l.relation === 'next')?.url
      path = next ? next.slice(next.indexOf('/fhir/') + '/fhir/'.length) : undefined
    }
    return resources
  }
  return { request, read, search }
}

async function main() {
  const envFile = new URL('../.env', import.meta.url)
  if (existsSync(envFile)) process.loadEnvFile?.(envFile)
  const options = parseArgs(process.argv.slice(2))
  const fhir = aidbox()

  const carePlan = await fhir.read(`CarePlan/${encodeURIComponent(options.carePlanId)}`)
  if (!carePlan) throw new Error(`CarePlan/${options.carePlanId} not found.`)

  // The catalog: the active ChargeItemDefinitions, by GOZ number. R4 defines no `code` search
  // parameter for ChargeItemDefinition, so the lookup by code happens here.
  const definitions = new Map()
  for (const definition of await fhir.search('ChargeItemDefinition?status=active&_count=500')) {
    for (const coding of definition.code?.coding ?? []) {
      if (coding.system === GOZ_SYSTEM && !definitions.has(coding.code)) definitions.set(coding.code, definition)
    }
  }
  if (definitions.size === 0) throw new Error('The GOZ catalog is not loaded (no active ChargeItemDefinition); run npm run setup.')

  // The teeth: every resource the activities give as their reason.
  const resources = new Map()
  for (const { reference } of (carePlan.activity ?? []).flatMap((a) => a.detail?.reasonReference ?? [])) {
    if (reference && !resources.has(reference)) resources.set(reference, await fhir.read(reference))
  }

  // The Coverage the Account bills against.
  let coverageId = options.coverage
  if (!coverageId) {
    const coverages = await fhir.search(`Coverage?beneficiary=${encodeURIComponent(carePlan.subject?.reference ?? '')}&status=active&_count=10`)
    if (coverages.length !== 1) throw new Error(`${carePlan.subject?.reference} has ${coverages.length} active Coverages; name one with --coverage <id>.`)
    coverageId = coverages[0].id
  }

  const { account, chargeItems } = buildCostPlan({
    carePlan,
    definitionFor: (code) => definitions.get(code),
    resolve: (reference) => resources.get(reference),
    coverage: { reference: `Coverage/${coverageId}` },
    owner: { reference: `Organization/${options.owner}` },
    factors: options.factors,
  })

  // Base R4 validation: Account and ChargeItem have no profile in this kit (README, "Known gaps").
  // Aidbox's $validate also checks that references exist. Before the write the only accepted
  // miss is the Account this transaction creates; after the write nothing is accepted.
  const validate = async (resource, pendingReference) => {
    const { json } = await fhir.request('POST', `${resource.resourceType}/$validate`, resource)
    const errors = (json?.issue ?? []).filter((issue) => ['error', 'fatal'].includes(issue.severity))
      .filter((issue) => !(pendingReference && issue.details?.coding?.some((c) => c.code === 'non-existent-resource') &&
        issue.diagnostics === `Referenced resource ${pendingReference} does not exist`))
    if (json?.resourceType !== 'OperationOutcome' || errors.length) {
      throw new Error(`$validate ${resource.resourceType}/${resource.id}: ${errors.map((e) => e.diagnostics ?? e.details?.text ?? e.code).join('; ') || `HTTP response without an OperationOutcome`}`)
    }
  }
  for (const resource of [account, ...chargeItems]) await validate(resource, `Account/${account.id}`)

  // Replace the cost plan: ChargeItems of this Account the plan no longer has are deleted.
  const keep = new Set(chargeItems.map((c) => c.id))
  const stale = (await fhir.search(`ChargeItem?account=Account/${account.id}&_count=1000`)).filter((c) => !keep.has(c.id))
  const bundle = {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: [
      ...[account, ...chargeItems].map((resource) => ({
        fullUrl: `urn:uuid:${resource.resourceType}-${resource.id}`,
        resource,
        request: { method: 'PUT', url: `${resource.resourceType}/${resource.id}` },
      })),
      ...stale.map((c) => ({ request: { method: 'DELETE', url: `ChargeItem/${c.id}` } })),
    ],
  }
  if (options.out) writeFileSync(options.out, `${JSON.stringify(bundle, null, 2)}\n`)

  const summary = `Account/${account.id}: ${chargeItems.length} planned ChargeItems from CarePlan/${carePlan.id}` +
    (stale.length ? `, ${stale.length} stale removed` : '')
  if (options.dryRun) {
    console.log(`Dry run, nothing written. ${summary}; all pass $validate.`)
    return
  }
  const { ok, status, json } = await fhir.request('POST', '', bundle)
  if (!ok) throw new Error(`Transaction: HTTP ${status} ${JSON.stringify(json?.issue ?? json)}`)
  // Read back what was stored and validate it again, now with every reference resolvable.
  for (const { resourceType, id } of [account, ...chargeItems]) await validate(await fhir.read(`${resourceType}/${id}`))
  console.log(`Written. ${summary}; read back, all pass $validate.`)
  console.log(`Check it: npm run cost-plan -- --aidbox ${carePlan.subject.reference.split('/')[1]}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
