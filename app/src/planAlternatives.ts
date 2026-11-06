// Treatment alternatives as dental-care-plan CarePlans (TASKS.md, task 2).
//
// A new alternative starts from a finding: an absent tooth in the current chart, together
// with the Condition about that tooth if one is recorded. Its shape follows the seeded
// CarePlan/dent-051-hkp-alt-b, so code that reads the seeded alternatives (planned chart,
// charges from plan activities) reads the new ones the same way.
//
// Choosing an alternative sets its intent to `plan` and every other draft alternative of the
// patient back to `option`. The status stays `draft`: choosing is the patient's preference
// among the alternatives, not yet consent or approval. See docs/adr/0001-chosen-alternative-stays-draft.md.

import { create, search, toothOf, type CarePlan, type CarePlanActivity, type ChargeItem, type Condition, type Observation, type Patient, type Reference, type Resource } from './fhir'
import { isToothPresent, toToothRecord } from './odontogram/chartAdapter'
import { t, type TranslationKey } from './i18n'

export const DENTAL_CARE_PLAN_PROFILE = 'https://fhir.cognovis.de/dental/StructureDefinition/dental-care-plan'
export const HKP_IDENTIFIER_SYSTEM = 'https://github.com/cognovis/fhir-camp-hackathon/sid/hkp'
const GOZ = 'http://fhir.de/CodeSystem/bzaek/goz'
const HTEST = { system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'HTEST', display: 'test health data' }
const DENTIST: Reference = { reference: 'Practitioner/fhir-camp-dentist' }

interface Account extends Resource { resourceType: 'Account'; coverage?: { coverage?: Reference }[] }

/** A gap in the chart a new alternative can treat. */
export interface Gap {
  tooth: string
  /** The latest tooth-state Observation of the tooth: the activities' reasonReference. */
  toothState: Observation
  /** The recorded Condition about this tooth, if any: the plan's `addresses`. */
  condition?: Condition
}

interface PlannedService {
  goz: string
  display: string
  /** Whether the service is for the gap tooth (reasonReference) or for the plan as a whole. */
  perTooth: boolean
}

export interface AlternativeTemplate {
  key: string
  /** The menu label in the browser language. Title, description and service displays are FHIR
   *  content written to Aidbox, so they stay German like the seeded alternatives. */
  labelKey: TranslationKey
  title: (gap: Gap) => string
  description: (gap: Gap) => string
  services: PlannedService[]
}

const jaw = (tooth: string) => (['1', '2', '5', '6'].includes(tooth[0] ?? '') ? 'Oberkiefer' : 'Unterkiefer')

export const ALTERNATIVE_TEMPLATES: AlternativeTemplate[] = [
  {
    key: 'cast-partial-denture',
    labelKey: 'template.cast-partial-denture',
    title: (gap) => `Modellgussprothese ${jaw(gap.tooth)}, Ersatz Zahn ${gap.tooth}`,
    description: (gap) =>
      `Herausnehmbare Teilprothese (Modellguss) im ${jaw(gap.tooth)} mit gegossenen Halte- und Stützelementen; ersetzt Zahn ${gap.tooth}, die Nachbarzähne werden nicht beschliffen.`,
    services: [
      { goz: '0030', display: 'Heil- und Kostenplan', perTooth: false },
      { goz: '5210', display: 'Modellgussprothese mit gegossenen Halte- und Stützelementen', perTooth: true },
    ],
  },
]

/** Absent teeth of the current chart, each with the Condition recorded for that tooth. */
export function findGaps(toothStates: Observation[], conditions: Condition[]): Gap[] {
  return toothStates
    .filter((o) => !isToothPresent(toToothRecord(o)))
    .map((toothState) => {
      const tooth = toothOf(toothState.bodySite) ?? ''
      const condition = conditions.find((c) => c.bodySite?.some((site) => toothOf(site) === tooth))
      return { tooth, toothState, condition }
    })
    .filter((gap) => gap.tooth)
    .sort((a, b) => Number(Boolean(b.condition)) - Number(Boolean(a.condition)) || a.tooth.localeCompare(b.tooth))
}

/** The next HKP identifier and alternative letter, continuing the patient's existing plans. */
function nextIdentifier(patient: Patient, existing: CarePlan[], today: string): { value: string; letter: string } {
  const values = existing.flatMap((p) => p.identifier ?? []).filter((i) => i.system === HKP_IDENTIFIER_SYSTEM).map((i) => i.value ?? '')
  const lettered = values.map((v) => /^(.*-)([A-Z])$/.exec(v)).filter((m): m is RegExpExecArray => m !== null)
  const prefix = lettered[0]?.[1] ?? `HKP-${today.slice(0, 4)}-${patient.id}-`
  const used = new Set(lettered.filter((m) => m[1] === prefix).map((m) => m[2]))
  const letter = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].find((l) => !used.has(l))
  if (letter) return { value: `${prefix}${letter}`, letter }
  const n = existing.length + 1
  return { value: `${prefix}${n}`, letter: String(n) }
}

function activity(service: PlannedService, gap: Gap): CarePlanActivity {
  const text = `GOZ ${service.goz} ${service.display}`
  return {
    detail: {
      kind: 'ServiceRequest',
      code: { coding: [{ system: GOZ, code: service.goz, display: service.display }], text },
      status: 'not-started',
      ...(service.perTooth ? { reasonReference: [{ reference: `Observation/${gap.toothState.id}` }] } : {}),
      description: service.perTooth ? `${text}, Zahn ${gap.tooth}` : text,
    },
  }
}

/** A new treatment alternative (status draft, intent option) for one gap. */
export function buildAlternative(input: {
  patient: Patient
  gap: Gap
  template: AlternativeTemplate
  existing: CarePlan[]
  today: string
}): Omit<CarePlan, 'id'> {
  const { patient, gap, template, existing, today } = input
  const identifier = nextIdentifier(patient, existing, today)
  const evidence = gap.condition?.evidence?.flatMap((e) => e.detail ?? []) ?? []
  // The alternatives of one finding share the planned start (it dates the cost plan, see
  // billing/charges-from-plan.mjs); without a sibling alternative the plan starts today.
  const sibling = existing.find((p) => p.period?.start && gap.condition && p.addresses?.some((r) => r.reference === `Condition/${gap.condition?.id}`))
  return {
    resourceType: 'CarePlan',
    meta: { profile: [DENTAL_CARE_PLAN_PROFILE], tag: [HTEST] },
    identifier: [{ system: HKP_IDENTIFIER_SYSTEM, value: identifier.value }],
    status: 'draft',
    intent: 'option',
    category: [
      { coding: [{ system: 'https://fhir.cognovis.de/dental/CodeSystem/dental-category', code: 'dental', display: 'Dental' }] },
      { coding: [{ system: 'https://fhir.cognovis.de/dental/CodeSystem/dental-care-plan-type', code: 'hkp' }] },
    ],
    title: `HKP Alternative ${identifier.letter}: ${template.title(gap)}`,
    description: template.description(gap),
    subject: { reference: `Patient/${patient.id}` },
    period: { start: sibling?.period?.start ?? today },
    created: today,
    author: DENTIST,
    ...(gap.condition ? { addresses: [{ reference: `Condition/${gap.condition.id}` }] } : {}),
    ...(evidence.length > 0 ? { supportingInfo: evidence.map((r) => ({ reference: r.reference })) } : {}),
    activity: template.services.map((service) => activity(service, gap)),
  }
}

function localToday(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * The Coverage the sibling alternatives (plans addressing the same Condition) are priced on,
 * when they agree on one. A patient can hold several active Coverages, so charges-from-plan
 * needs it named; without a sibling cost plan it is left to charges-from-plan to decide.
 */
async function siblingCoverage(patient: Patient, alternative: Omit<CarePlan, 'id'>, existing: CarePlan[]): Promise<string | undefined> {
  const condition = alternative.addresses?.[0]?.reference
  if (!condition) return undefined
  const siblings = new Set(existing.filter((p) => p.addresses?.some((r) => r.reference === condition)).map((p) => `CarePlan/${p.id}`))
  if (siblings.size === 0) return undefined
  const charges = await search<ChargeItem>(`ChargeItem?subject=Patient/${patient.id}&_count=500`)
  const accounts = new Set(charges
    .filter((c) => c.supportingInformation?.some((r) => r.reference && siblings.has(r.reference)))
    .flatMap((c) => c.account ?? [])
    .map((r) => r.reference?.replace(/^Account\//, ''))
    .filter((id): id is string => Boolean(id)))
  if (accounts.size === 0) return undefined
  const found = await search<Account>(`Account?_id=${[...accounts].join(',')}`)
  const coverages = new Set(found.flatMap((a) => a.coverage ?? []).map((c) => c.coverage?.reference))
  const [only] = coverages
  return coverages.size === 1 && only?.startsWith('Coverage/') ? only.slice('Coverage/'.length) : undefined
}

/**
 * Writes a new alternative for one gap, with its cost plan. The next letter comes from the
 * patient's CarePlans as Aidbox holds them now, and the create is conditional on the HKP
 * identifier (If-None-Exist), so Aidbox itself refuses a second plan with the same identifier.
 * The cost plan (Account and planned ChargeItems) comes from billing/charges-from-plan.mjs on
 * the dev server, as for a duplicated plan. The CarePlan is saved even when its cost plan
 * fails (for example, a patient without a Coverage), so that error comes back next to the plan.
 */
export async function createAlternative(
  patient: Patient,
  gap: Gap,
  template: AlternativeTemplate,
): Promise<{ created: CarePlan; costPlanError?: Error }> {
  const existing = await search<CarePlan>(`CarePlan?subject=Patient/${patient.id}&_count=100`)
  const alternative = buildAlternative({ patient, gap, template, existing, today: localToday() })
  const identifier = alternative.identifier?.[0]?.value ?? ''
  const created = await create<CarePlan>(alternative, { ifNoneExist: `identifier=${encodeURIComponent(`${HKP_IDENTIFIER_SYSTEM}|${identifier}`)}` })
  const response = await siblingCoverage(patient, alternative, existing)
    .then((coverage) => fetch('/api/charges-from-plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ carePlan: created.id, ...(coverage ? { coverage } : {}) }),
    }))
    .catch((error: unknown) => error as Error)
  if (response instanceof Response && response.ok) return { created }
  const reason = response instanceof Response
    ? ((await response.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${response.status}`
    : response.message
  return { created, costPlanError: new Error(t('chargesSaveError', { name: created.title, detail: reason })) }
}

/** Whether an alternative can still be chosen: only draft plans are open for a choice. */
export function isChoosable(plan: CarePlan): boolean {
  return plan.status === 'draft'
}

/**
 * The CarePlans to write when the patient chooses one alternative: every draft alternative,
 * the chosen one with intent `plan`, the others with intent `option`. Writing all of them,
 * each guarded by its version, makes two concurrent choices conflict instead of leaving two
 * chosen plans. Plans already past draft (active, completed) are left as they are.
 */
export function chooseAlternative(plans: CarePlan[], chosenId: string): CarePlan[] {
  const chosen = plans.find((p) => p.id === chosenId)
  if (!chosen) throw new Error(t('chooseUnknownPlan', { id: chosenId }))
  if (!isChoosable(chosen)) throw new Error(t('chooseNotDraft', { id: chosenId, status: chosen.status }))
  return plans.filter(isChoosable).map((plan) => ({ ...plan, intent: plan.id === chosenId ? 'plan' : 'option' }))
}
