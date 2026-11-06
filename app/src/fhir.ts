// Minimal FHIR R4 access to the local Aidbox through the Vite proxy (/fhir).
// Only the fields the starter app reads are typed; add more as your task needs them.

export interface Coding { system?: string; code?: string; display?: string }
export interface CodeableConcept { coding?: Coding[]; text?: string }
export interface Reference { reference?: string; display?: string }
export interface Extension { url: string; valueCoding?: Coding; valueString?: string }

export interface Resource { resourceType: string; id: string; meta?: { profile?: string[]; versionId?: string } }

export interface Patient extends Resource {
  resourceType: 'Patient'
  name?: { family?: string; given?: string[]; text?: string }[]
  birthDate?: string
  gender?: string
}

export interface ObservationComponent {
  extension?: Extension[]
  code: CodeableConcept
  valueCodeableConcept?: CodeableConcept
}

export interface Observation extends Resource {
  resourceType: 'Observation'
  status: string
  code: CodeableConcept
  effectiveDateTime?: string
  bodySite?: CodeableConcept
  note?: { text: string }[]
  component?: ObservationComponent[]
  hasMember?: Reference[]
  valueCodeableConcept?: CodeableConcept
}

export interface Condition extends Resource {
  resourceType: 'Condition'
  code?: CodeableConcept
  bodySite?: CodeableConcept[]
  recordedDate?: string
}

export interface CarePlanActivity {
  detail?: {
    code?: CodeableConcept
    status?: string
    reasonReference?: Reference[]
    description?: string
  }
}

export interface CarePlan extends Resource {
  resourceType: 'CarePlan'
  status: string
  intent: string
  title?: string
  description?: string
  created?: string
  activity?: CarePlanActivity[]
}

export interface ChargeItem extends Resource {
  resourceType: 'ChargeItem'
  status: string
  code: CodeableConcept
  bodysite?: CodeableConcept[]
  quantity?: { value?: number }
  factorOverride?: number
  reason?: CodeableConcept[]
  supportingInformation?: Reference[]
  account?: Reference[]
}

interface Bundle<T> { entry?: { resource: T }[] }

// Every FHIR call of the app goes through fhirRequest, which records it in the request log that
// the FHIR panel shows. Call it for your own writes too, so they appear there.
export interface FhirLogEntry {
  id: number
  method: string
  url: string
  status?: number
  durationMs?: number
  requestBody?: unknown
  responseBody?: unknown
  error?: string
  at: string
}

type LogListener = (entries: readonly FhirLogEntry[]) => void
const LOG_LIMIT = 200
let logEntries: readonly FhirLogEntry[] = []
let nextLogId = 1
const logListeners = new Set<LogListener>()

function writeLog(entry: FhirLogEntry) {
  const rest = logEntries.filter((e) => e.id !== entry.id)
  logEntries = [entry, ...rest].slice(0, LOG_LIMIT)
  for (const listener of logListeners) listener(logEntries)
}

export function subscribeFhirLog(listener: LogListener): () => void {
  logListeners.add(listener)
  listener(logEntries)
  return () => { logListeners.delete(listener) }
}

export function clearFhirLog() {
  logEntries = []
  for (const listener of logListeners) listener(logEntries)
}

// body is the parsed JSON, or undefined when the server answered with something else (for example
// a proxy error page); text is the raw answer in both cases.
export async function fhirRequest<T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T | undefined; text: string }> {
  const url = path ? `/fhir/${path}` : '/fhir'
  const entry: FhirLogEntry = { id: nextLogId++, method, url, requestBody: body, at: new Date().toISOString() }
  writeLog(entry)
  const started = performance.now()
  try {
    const response = await fetch(url, {
      method,
      headers: { accept: 'application/fhir+json', ...(body === undefined ? {} : { 'content-type': 'application/fhir+json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await response.text()
    let parsed: T | undefined
    try { parsed = text ? (JSON.parse(text) as T) : undefined } catch { parsed = undefined }
    writeLog({ ...entry, status: response.status, durationMs: Math.round(performance.now() - started), responseBody: parsed ?? text })
    return { status: response.status, body: parsed, text }
  } catch (e) {
    writeLog({ ...entry, durationMs: Math.round(performance.now() - started), error: (e as Error).message })
    throw e
  }
}

export async function search<T extends Resource>(query: string): Promise<T[]> {
  const { status, body, text } = await fhirRequest<Bundle<T>>('GET', query)
  if (status >= 400 || !body) throw new Error(`GET /fhir/${query}: HTTP ${status}${body ? '' : `, not FHIR JSON: ${text.slice(0, 120)}`}`)
  return (body.entry ?? []).map((entry) => entry.resource)
}

export interface OperationOutcome {
  resourceType: 'OperationOutcome'
  issue: { severity: 'fatal' | 'error' | 'warning' | 'information'; code: string; diagnostics?: string; expression?: string[]; details?: CodeableConcept }[]
}

// $validate against the resource's own meta.profile; Aidbox answers with an OperationOutcome
// for a valid and for an invalid resource alike.
export async function validateResource(resource: Resource): Promise<OperationOutcome> {
  const path = `${resource.resourceType}/$validate`
  const { status, body, text } = await fhirRequest<OperationOutcome>('POST', path, resource)
  if (body?.resourceType !== 'OperationOutcome') throw new Error(`POST /fhir/${path}: HTTP ${status}, no OperationOutcome: ${text.slice(0, 120)}`)
  return body
}

export interface PatientRecord {
  patient: Patient
  toothStates: Observation[]
  findings: Observation[]
  conditions: Condition[]
  carePlans: CarePlan[]
  chargeItems: ChargeItem[]
}

export const TOOTH_STATE_PROFILE = 'https://fhir.cognovis.de/dental-core/StructureDefinition/dental-tooth-state'
export const FDI_TOOTH_SYSTEM = 'https://fhir.cognovis.de/dental-core/CodeSystem/tooth-position-fdi'

export async function loadPatientRecord(patient: Patient): Promise<PatientRecord> {
  const subject = `Patient/${patient.id}`
  const [observations, conditions, carePlans, chargeItems] = await Promise.all([
    search<Observation>(`Observation?subject=${subject}&_count=500`),
    search<Condition>(`Condition?subject=${subject}&_count=100`),
    search<CarePlan>(`CarePlan?subject=${subject}&_count=100&_sort=_id`),
    search<ChargeItem>(`ChargeItem?subject=${subject}&_count=500&_sort=_id`),
  ])
  const isToothState = (o: Observation) => o.meta?.profile?.includes(TOOTH_STATE_PROFILE) ?? false
  return {
    patient,
    toothStates: latestPerTooth(observations.filter(isToothState)),
    findings: observations.filter((o) => !isToothState(o) && !o.hasMember),
    conditions,
    carePlans,
    chargeItems,
  }
}

export function toothOf(concept: CodeableConcept | undefined): string | undefined {
  return concept?.coding?.find((c) => c.system === FDI_TOOTH_SYSTEM)?.code
}

// One tooth-state Observation per tooth: the most recent effective date wins.
function latestPerTooth(observations: Observation[]): Observation[] {
  const byTooth = new Map<string, Observation>()
  for (const observation of observations) {
    const tooth = toothOf(observation.bodySite)
    if (!tooth) continue
    const current = byTooth.get(tooth)
    if (!current || (observation.effectiveDateTime ?? '') > (current.effectiveDateTime ?? '')) byTooth.set(tooth, observation)
  }
  return [...byTooth.values()]
}

export function patientName(patient: Patient): string {
  const name = patient.name?.[0]
  if (!name) return patient.id
  return name.text ?? [...(name.given ?? []), name.family].filter(Boolean).join(' ')
}

export function display(concept: CodeableConcept | undefined): string {
  return concept?.text ?? concept?.coding?.[0]?.display ?? concept?.coding?.[0]?.code ?? ''
}
