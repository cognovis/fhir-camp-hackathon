import { t } from './i18n.ts'
// New treatment alternatives: a CarePlan (dental-care-plan profile) written to Aidbox through the
// /fhir proxy, either blank or as a copy of another alternative. A copy gets its cost plan
// (Account and planned ChargeItems) from billing/charges-from-plan.mjs on the dev server.

import { fhirRequest, type CarePlan, type ChargeItem, type Patient } from './fhir.ts'

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
          // charges-from-plan.mjs dates the cost plan by period.start once services are added.
          period: { start: today },
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
  const { status, body: json } = await fhirRequest<T & { resourceType?: string }>(method, path, body)
  if (status >= 400 && json?.resourceType !== 'OperationOutcome') throw new Error(`${method} /fhir/${path}: HTTP ${status}`)
  return json as T
}

// $validate against the profile the CarePlan claims, then write it; nothing is written on an error.
async function writeCarePlan(carePlan: CarePlan): Promise<CarePlan> {
  const outcome = await fhir<OperationOutcome>('POST', 'CarePlan/$validate', carePlan)
  const errors = (outcome?.issue ?? []).filter((i) => ['error', 'fatal'].includes(i.severity))
  if (outcome?.resourceType !== 'OperationOutcome' || errors.length) {
    throw new Error(t('validationError', { detail: errors.map((e) => e.diagnostics ?? e.details?.text).join('; ') || t('noOutcome') }))
  }
  const saved = await fhir<CarePlan | OperationOutcome>('PUT', `CarePlan/${encodeURIComponent(carePlan.id)}`, carePlan)
  if (saved.resourceType !== 'CarePlan') throw new Error(t('planSaveError', { id: carePlan.id }))
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
    if (accounts.size !== 1) throw new Error(t('copyAccount'))
    const accountRef = [...accounts][0]
    if (!accountRef || !/^Account\/[A-Za-z0-9.-]{1,64}$/.test(accountRef)) throw new Error(t('invalidAccount'))
    const account = await fhir<{ resourceType: string; subject?: { reference?: string }[]; coverage?: { coverage?: { reference?: string } }[] }>('GET', accountRef)
    if (account.resourceType !== 'Account' || !account.subject?.some((r) => r.reference === `Patient/${patient.id}`)) throw new Error(t('foreignAccount'))
    const coverages = account.coverage ?? []
    const reference = coverages[0]?.coverage?.reference
    if (coverages.length !== 1 || !reference || !/^Coverage\/[A-Za-z0-9.-]{1,64}$/.test(reference)) throw new Error(t('copyCoverage'))
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
    if (!response.ok) throw new Error(t('chargesSaveError', { name: saved.title, detail: (body as { error?: string }).error ?? `HTTP ${response.status}` }))
  }
  return saved
}

// Deletes one alternative with its cost plan: the CarePlan, the Accounts of its planned
// ChargeItems (and the `<id>-cost-plan` Account charges-from-plan writes) and those ChargeItems,
// in one transaction, so nothing is left half deleted. The chosen alternative (intent = plan) is
// refused. The check reads the CarePlan fresh and the delete carries its version (If-Match), so a
// plan chosen in another session after the check is not deleted. `npm run setup` restores the
// seeded alternatives.
export async function deletePlan(loaded: CarePlan, chargeItems: ChargeItem[]): Promise<void> {
  const fresh = await fhirRequest<CarePlan>('GET', `CarePlan/${encodeURIComponent(loaded.id)}`)
  if (fresh.status >= 400 || !fresh.body) throw new Error(`GET CarePlan/${loaded.id}: HTTP ${fresh.status}`)
  const carePlan = fresh.body
  if (carePlan.intent === 'plan') throw new Error(t('chosenDeleteError', { name: carePlan.title ?? carePlan.id }))
  const version = carePlan.meta?.versionId
  if (!version) throw new Error(t('noVersion', { id: carePlan.id }))
  // The loaded ChargeItems plus the ones charges-from-plan wrote since, read fresh by their Account.
  const generatedAccount = `Account/${carePlan.id}-cost-plan`
  const search = await fhirRequest<{ entry?: { resource: ChargeItem }[] }>('GET', `ChargeItem?account=${encodeURIComponent(generatedAccount)}&_count=1000`)
  if (search.status >= 400 || !search.body) throw new Error(`GET ChargeItem?account=${generatedAccount}: HTTP ${search.status}`)
  const found = (search.body.entry ?? []).map((e) => e.resource)
  const byId = new Map([...chargeItems, ...found].map((c) => [c.id, c]))
  const charges = [...byId.values()].filter((c) =>
    c.supportingInformation?.some((r) => r.reference === `CarePlan/${carePlan.id}`) || c.account?.some((r) => r.reference === generatedAccount))
  const accounts = new Set(charges.flatMap((c) => c.account ?? []).map((r) => r.reference).filter((r): r is string => !!r?.startsWith('Account/')))
  // A plan without services can still have its generated (empty) Account.
  const generated = await fhirRequest('GET', generatedAccount)
  if (generated.status < 400) accounts.add(generatedAccount)
  const requests = [
    ...[...charges.map((c) => `ChargeItem/${c.id}`), ...accounts].map((url) => ({ method: 'DELETE', url })),
    { method: 'DELETE', url: `CarePlan/${carePlan.id}`, ifMatch: `W/"${version}"` },
  ]
  const response = await fhirRequest<OperationOutcome>('POST', '', {
    resourceType: 'Bundle', type: 'transaction', entry: requests.map((request) => ({ request })),
  })
  if (response.status >= 400) {
    const outcome = response.body
    throw new Error(t('deleteError', { id: carePlan.id, detail: `HTTP ${response.status} ${outcome?.issue?.map((i) => i.diagnostics).join('; ') ?? ''}`.trim() }))
  }
}
