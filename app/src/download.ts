// Download FHIR resources as a Bundle (type collection), read fresh from Aidbox through the /fhir
// proxy, so a saved justification or a new alternative is in the file.

import { search, type CarePlan, type Patient, type Resource } from './fhir'

interface Bundle { resourceType: 'Bundle'; type: 'collection'; timestamp: string; meta: { tag: unknown[] }; entry: { fullUrl: string; resource: Resource }[] }

const HTEST = { system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'HTEST', display: 'test health data' }

function toBundle(resources: Resource[]): Bundle {
  // One entry per resource, in the order given; a resource found twice is kept once.
  const seen = new Set<string>()
  const unique = resources.filter((r) => { const key = `${r.resourceType}/${r.id}`; if (seen.has(key)) return false; seen.add(key); return true })
  return {
    resourceType: 'Bundle',
    type: 'collection',
    timestamp: new Date().toISOString(),
    meta: { tag: [HTEST] },
    entry: unique.map((resource) => ({ fullUrl: `${location.origin}/fhir/${resource.resourceType}/${resource.id}`, resource })),
  }
}

function save(filename: string, bundle: Bundle) {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(bundle, null, 2)}\n`], { type: 'application/fhir+json' }))
  const link = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

// Everything the app shows for the patient: demographics, insurance, chart, findings, plans and cost plans.
export async function downloadPatient(patient: Patient): Promise<void> {
  const subject = `Patient/${patient.id}`
  const [patients, coverages, observations, conditions, carePlans, accounts, chargeItems] = await Promise.all([
    search<Resource>(`Patient?_id=${patient.id}`),
    search<Resource & { contract?: { reference?: string }[] }>(`Coverage?beneficiary=${subject}&_count=100`),
    search<Resource>(`Observation?subject=${subject}&_count=1000`),
    search<Resource>(`Condition?subject=${subject}&_count=200`),
    search<Resource>(`CarePlan?subject=${subject}&_count=200&_sort=_id`),
    search<Resource>(`Account?subject=${subject}&_count=200&_sort=_id`),
    search<Resource>(`ChargeItem?subject=${subject}&_count=1000&_sort=_id`),
  ])
  const contractIds = coverages.flatMap((c) => c.contract ?? []).map((r) => r.reference?.split('/')[1]).filter(Boolean)
  const contracts = contractIds.length ? await search<Resource>(`Contract?_id=${contractIds.join(',')}`) : []
  save(`${patient.id}-fhir-bundle.json`, toBundle([...patients, ...coverages, ...contracts, ...observations, ...conditions, ...carePlans, ...accounts, ...chargeItems]))
}

// One treatment alternative: the CarePlan, its cost plan Account and the planned ChargeItems.
// R4 has no ChargeItem search by supportingInformation, so the patient's ChargeItems are filtered here.
type ChargeRef = Resource & { account?: { reference?: string }[]; supportingInformation?: { reference?: string }[] }
export async function downloadPlan(carePlan: CarePlan): Promise<void> {
  const subject = (carePlan as CarePlan & { subject?: { reference?: string } }).subject?.reference ?? ''
  const [plans, charges] = await Promise.all([
    search<CarePlan>(`CarePlan?_id=${carePlan.id}`),
    search<ChargeRef>(`ChargeItem?subject=${subject}&_count=1000&_sort=_id`),
  ])
  const chargeItems = charges.filter((c) => c.supportingInformation?.some((r) => r.reference === `CarePlan/${carePlan.id}`))
  const accountIds = [...new Set(chargeItems.flatMap((c) => c.account ?? []).map((r) => r.reference?.split('/')[1]).filter(Boolean))]
  const accounts = accountIds.length ? await search<Resource>(`Account?_id=${accountIds.join(',')}`) : []
  save(`${carePlan.id}-fhir-bundle.json`, toBundle([...plans, ...accounts, ...chargeItems]))
}
