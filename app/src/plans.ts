// New treatment alternatives: a CarePlan (dental-care-plan profile) written to Aidbox through the
// /fhir proxy, either blank or as a copy of another alternative. A copy gets its cost plan
// (Account and planned ChargeItems) from billing/charges-from-plan.mjs on the dev server.

import type { CarePlan, ChargeItem, Patient } from './fhir'

const HTEST = { system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'HTEST', display: 'test health data' }
const DENTAL_CARE_PLAN = 'https://fhir.cognovis.de/dental/StructureDefinition/dental-care-plan'
const HKP_SYSTEM = 'https://github.com/cognovis/fhir-camp-hackathon/sid/hkp'

interface OperationOutcome { resourceType: 'OperationOutcome'; issue?: { severity: string; diagnostics?: string; details?: { text?: string } }[] }

// The next free letter: dent-051 has A to C, so a new plan is D.
function nextLetter(carePlans: CarePlan[]): string {
  const used = new Set(carePlans.map((p) => /Alternative ([A-Z])\b/.exec(p.title ?? '')?.[1]).filter(Boolean))
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i)
    if (!used.has(letter)) return letter
  }
  return `${carePlans.length + 1}`
}

export function buildCarePlan(patient: Patient, carePlans: CarePlan[], source?: CarePlan): CarePlan {
  const letter = nextLetter(carePlans)
  let id = `${patient.id}-hkp-alt-${letter.toLowerCase()}`
  for (let n = 2; carePlans.some((p) => p.id === id); n++) id = `${patient.id}-hkp-alt-${letter.toLowerCase()}${n}`
  const today = new Date().toISOString().slice(0, 10)
  const sourceSubject = source?.title?.split(':').slice(1).join(':').trim()
  // Everything of the source except its identity, its choice (intent) and its business identifier.
  const { id: _id, meta: _meta, identifier: _identifier, ...copy } = (source ?? {}) as CarePlan & { identifier?: unknown }
  return {
    ...(source
      ? copy
      : {
          category: [
            { coding: [{ system: 'https://fhir.cognovis.de/dental/CodeSystem/dental-category', code: 'dental', display: 'Dental' }] },
            { coding: [{ system: 'https://fhir.cognovis.de/dental/CodeSystem/dental-care-plan-type', code: 'hkp' }] },
          ],
          subject: { reference: `Patient/${patient.id}` },
        }),
    resourceType: 'CarePlan',
    id,
    meta: { profile: [DENTAL_CARE_PLAN], tag: [HTEST] },
    identifier: [{ system: HKP_SYSTEM, value: `HKP-${today.slice(0, 4)}-${patient.id.replace(/\D/g, '')}-${letter}` }],
    status: 'draft',
    intent: 'option',
    title: `HKP Alternative ${letter}: ${source ? `${sourceSubject} (Kopie)` : 'Neuer Plan'}`,
    description: source ? `Kopie von ${source.title ?? source.id}.` : 'Neue Behandlungsalternative ohne geplante Leistungen.',
    created: today,
  } as unknown as CarePlan
}

async function fhir<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/fhir/${path}`, {
    method,
    headers: { accept: 'application/fhir+json', ...(body ? { 'content-type': 'application/fhir+json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const json = await response.json().catch(() => undefined)
  if (!response.ok && json?.resourceType !== 'OperationOutcome') throw new Error(`${method} /fhir/${path}: HTTP ${response.status}`)
  return json as T
}

// $validate against the profile the CarePlan claims, then write it; nothing is written on an error.
async function writeCarePlan(carePlan: CarePlan): Promise<CarePlan> {
  const outcome = await fhir<OperationOutcome>('POST', 'CarePlan/$validate', carePlan)
  const errors = (outcome?.issue ?? []).filter((i) => ['error', 'fatal'].includes(i.severity))
  if (outcome?.resourceType !== 'OperationOutcome' || errors.length) {
    throw new Error(`CarePlan does not pass $validate: ${errors.map((e) => e.diagnostics ?? e.details?.text).join('; ') || 'no OperationOutcome'}`)
  }
  const saved = await fhir<CarePlan | OperationOutcome>('PUT', `CarePlan/${encodeURIComponent(carePlan.id)}`, carePlan)
  if (saved.resourceType !== 'CarePlan') throw new Error(`PUT CarePlan/${carePlan.id} failed`)
  return saved
}

// The multiplier per GOZ number the source plan uses, so a copy keeps for example 9010 at 3.0.
function factorsOf(source: CarePlan, chargeItems: ChargeItem[]): Record<string, number> {
  const factors: Record<string, number> = {}
  for (const charge of chargeItems) {
    if (!charge.supportingInformation?.some((r) => r.reference === `CarePlan/${source.id}`)) continue
    const code = charge.code.coding?.[0]?.code
    if (code && charge.factorOverride !== undefined) factors[code] = charge.factorOverride
  }
  return factors
}

export async function createPlan(patient: Patient, carePlans: CarePlan[], chargeItems: ChargeItem[], source?: CarePlan): Promise<CarePlan> {
  let coverage: string | undefined
  if (source && (source.activity?.length ?? 0) > 0) {
    const accounts = new Set(chargeItems
      .filter((charge) => charge.supportingInformation?.some((r) => r.reference === `CarePlan/${source.id}`))
      .flatMap((charge) => charge.account ?? []).map((r) => r.reference))
    if (accounts.size !== 1) throw new Error('The source plan must have one unambiguous cost plan Account.')
    const accountRef = [...accounts][0]
    if (!accountRef || !/^Account\/[A-Za-z0-9.-]{1,64}$/.test(accountRef)) throw new Error('The source Account reference is invalid.')
    const account = await fhir<{ resourceType: string; subject?: { reference?: string }[]; coverage?: { coverage?: { reference?: string } }[] }>('GET', accountRef)
    if (account.resourceType !== 'Account' || !account.subject?.some((r) => r.reference === `Patient/${patient.id}`)) throw new Error('The source Account does not belong to this patient.')
    const coverages = account.coverage ?? []
    const reference = coverages[0]?.coverage?.reference
    if (coverages.length !== 1 || !reference || !/^Coverage\/[A-Za-z0-9.-]{1,64}$/.test(reference)) throw new Error('The source Account must have one unambiguous Coverage.')
    coverage = reference.split('/')[1]
  }
  const saved = await writeCarePlan(buildCarePlan(patient, carePlans, source))
  if (source && (saved.activity?.length ?? 0) > 0) {
    const response = await fetch('/api/charges-from-plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ carePlan: saved.id, coverage, factors: factorsOf(source, chargeItems) }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(`${saved.title} was saved, but its cost plan was not: ${(body as { error?: string }).error ?? `HTTP ${response.status}`}`)
  }
  return saved
}

// Deletes one alternative with its cost plan: the CarePlan, the Accounts of its planned
// ChargeItems (and the `<id>-cost-plan` Account charges-from-plan writes) and those ChargeItems,
// in one transaction, so nothing is left half deleted. The chosen alternative (intent = plan) is
// refused. `npm run setup` restores the seeded alternatives.
export async function deletePlan(carePlan: CarePlan, chargeItems: ChargeItem[]): Promise<void> {
  if (carePlan.intent === 'plan') throw new Error(`${carePlan.title ?? carePlan.id} is the chosen alternative and cannot be deleted.`)
  const charges = chargeItems.filter((c) => c.supportingInformation?.some((r) => r.reference === `CarePlan/${carePlan.id}`))
  const accounts = new Set(charges.flatMap((c) => c.account ?? []).map((r) => r.reference).filter((r): r is string => !!r?.startsWith('Account/')))
  // A plan without services can still have its generated (empty) Account.
  const generated = await fetch(`/fhir/Account/${encodeURIComponent(`${carePlan.id}-cost-plan`)}`, { headers: { accept: 'application/fhir+json' } })
  if (generated.ok) accounts.add(`Account/${carePlan.id}-cost-plan`)
  const urls = [...charges.map((c) => `ChargeItem/${c.id}`), ...accounts, `CarePlan/${carePlan.id}`]
  const response = await fetch('/fhir', {
    method: 'POST',
    headers: { 'content-type': 'application/fhir+json', accept: 'application/fhir+json' },
    body: JSON.stringify({ resourceType: 'Bundle', type: 'transaction', entry: urls.map((url) => ({ request: { method: 'DELETE', url } })) }),
  })
  if (!response.ok) {
    const outcome = await response.json().catch(() => undefined)
    throw new Error(`Delete ${carePlan.id}: HTTP ${response.status} ${outcome?.issue?.map((i: { diagnostics?: string }) => i.diagnostics).join('; ') ?? ''}`.trim())
  }
}
