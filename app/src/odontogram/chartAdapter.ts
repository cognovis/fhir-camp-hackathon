// INTEGRATION POINT: odontogram adapter.
//
// The starter app draws the chart with `@cognovis/react-odontogram` (MIT, 5.2.6 on
// npm.cognovis.de, source https://github.com/cognovis/React-Odontogram-Modul), the cognovis fork
// of React Advanced Odontogram by Zoltán Dul. Every FHIR-to-chart decision lives in this folder,
// so a team can swap the chart component by replacing this module and `OdontogramView.tsx`,
// keeping the rest of the app as it is.
//
// The contract the rest of the app relies on:
//   toChartStatus(toothStates)            dental-core tooth-state Observations -> status chart
//   toPlanChart(status, carePlan, states) one CarePlan alternative -> planned chart
//   toToothState(patient, tooth, record)  one charted tooth -> new tooth-state Observation
//   changedTeeth(before, after)           teeth whose tooth-state Observation would differ
//
// The chart payload follows the upstream `importStatus()` JSON: { version, teeth, plan? },
// keyed by FDI tooth number. Only the fields this mapping sets are typed here.

import type { CarePlan, Coding, Extension, Observation, ObservationComponent, Patient } from '../fhir'
import { FDI_TOOTH_SYSTEM, TOOTH_STATE_PROFILE, toothOf } from '../fhir'

const CHART_VALUE = 'https://fhir.cognovis.de/dental-core/CodeSystem/dental-chart-value'
const COMPONENT = 'https://fhir.cognovis.de/dental-core/CodeSystem/dental-component'
const TOOTH_SURFACE_EXT = 'https://fhir.cognovis.de/dental-core/StructureDefinition/tooth-surface'
const FDI_SURFACE_SYSTEM = 'http://terminology.hl7.org/CodeSystem/FDI-surface'
const GOZ = 'http://fhir.de/CodeSystem/bzaek/goz'

type Surface = 'buccal' | 'lingual' | 'mesial' | 'distal' | 'occlusal'
type FillingMaterial = 'amalgam' | 'composite' | 'gic' | 'temporary'
type ToothSelection = 'none' | 'tooth-base' | 'milktooth' | 'implant' | 'no-tooth-after-extraction' | 'tooth-under-gum' | 'not-erupted'
type ToothSubstrate = 'natural' | 'crownprep' | 'radix' | 'broken'
// Restoration types whose upstream and dental-core codes are the same.
const PARTIAL_RESTORATIONS = ['inlay', 'onlay', 'veneer'] as const
type PartialRestoration = (typeof PARTIAL_RESTORATIONS)[number]
const isPartialRestoration = (code: string | undefined): code is PartialRestoration => PARTIAL_RESTORATIONS.some((r) => r === code)
type RestorationMaterial = 'none' | 'emax' | 'gold' | 'gradia' | 'zircon' | 'metal' | 'metal-ceramic' | 'telescope' | 'temporary'
// The chart keeps a root post apart from the endodontic state (it turns the legacy values
// endo-glass-pin and endo-metal-pin into endo-filling plus rootPostType).
type Endo = 'none' | 'endo-filling' | 'endo-filling-incomplete' | 'endo-medical-filling' | 'endo-resection'
type RootPost = 'none' | 'glass-fiber' | 'metal'

export interface ToothRecord {
  toothSelection?: ToothSelection
  toothSubstrate?: ToothSubstrate
  restorationType?: 'none' | 'crown' | 'bridge' | PartialRestoration
  restorationMaterial?: RestorationMaterial
  // The surfaces an inlay, onlay or veneer covers.
  inlayCoverage?: Surface[]
  onlayCoverage?: Surface[]
  veneerCoverage?: Surface[]
  bridgePillar?: boolean
  fillingSurfaces?: Surface[]
  fillingSurfaceMaterials?: Partial<Record<Surface, FillingMaterial>>
  endo?: Endo
  rootPostType?: RootPost
  // Apicoectomy, and hemisection, root amputation or premolarisation; dental-core has no
  // tooth-state code for either.
  endoResection?: boolean
  rootResection?: 'none' | 'hemisection' | 'amputation' | 'premolarisation'
  prosthesis?: 'none' | 'removable-partial' | 'removable-full'
}

/** A tooth (natural, primary, implant, retained or unerupted) stands in the position. */
export function isToothPresent(record: ToothRecord): boolean {
  return !['none', 'no-tooth-after-extraction'].includes(record.toothSelection ?? 'tooth-base')
}

export type ChartTeeth = Record<string, ToothRecord>

export interface ChartPayload {
  version: string
  teeth: ChartTeeth
  plan?: ChartTeeth
}

// The payload version this mapping was written against (react-advanced-odontogram 2.8); the
// cognovis fork still reads it.
export const PAYLOAD_VERSION = '2.3'

const FDI_SURFACE: Record<string, Surface> = { M: 'mesial', O: 'occlusal', I: 'occlusal', D: 'distal', B: 'buccal', V: 'buccal', L: 'lingual', P: 'lingual' }

// Upstream chart values and their dental-core codes (dental-chart-value). The FHIR-to-chart
// direction is the inverse of the same table. Upstream values without a dental-core code are not
// written (endo-resection).
const PRESENCE_TO_FHIR: Record<ToothSelection, string> = {
  'tooth-base': 'tooth-present',
  milktooth: 'primary-tooth-present',
  implant: 'implant-in-tooth-position',
  none: 'tooth-absent',
  'no-tooth-after-extraction': 'tooth-absent-extracted',
  'tooth-under-gum': 'tooth-retained-under-gingiva',
  'not-erupted': 'tooth-not-erupted',
}
const SUBSTRATE_TO_FHIR: Partial<Record<ToothSubstrate, string>> = { crownprep: 'prepared-for-crown', radix: 'retained-root', broken: 'crown-destroyed' }
const MATERIAL_TO_FHIR: Partial<Record<RestorationMaterial, string>> = {
  emax: 'lithium-disilicate-ceramic',
  gold: 'gold-alloy',
  gradia: 'indirect-composite',
  zircon: 'zirconia',
  metal: 'cast-metal-alloy',
  'metal-ceramic': 'metal-ceramic',
  temporary: 'temporary-material',
}
const FILLING_TO_FHIR: Record<FillingMaterial, string> = { amalgam: 'amalgam', composite: 'composite-resin', gic: 'glass-ionomer-cement', temporary: 'temporary-material' }
const ENDO_TO_FHIR: Partial<Record<Endo, string>> = {
  'endo-filling': 'root-canal-filling',
  'endo-filling-incomplete': 'incomplete-root-canal-filling',
  'endo-medical-filling': 'intracanal-medicament',
}
const ROOT_POST_TO_FHIR: Partial<Record<RootPost, string>> = { 'glass-fiber': 'glass-fiber-post', metal: 'metal-post' }
const SURFACE_TO_FDI: Record<Surface, string> = { mesial: 'M', distal: 'D', buccal: 'B', lingual: 'L', occlusal: 'O' }

function invert<K extends string>(table: Partial<Record<K, string>>): Partial<Record<string, K>> {
  return Object.fromEntries(Object.entries(table).map(([key, code]) => [code, key]))
}
const PRESENCE_FROM_FHIR = invert(PRESENCE_TO_FHIR)
// A crown or telescope reads as built on a prepared tooth unless the substrate says otherwise, so a
// crown on natural tooth structure carries that substrate explicitly (see toToothStateComponents).
const NATURAL_SUBSTRATE = 'natural-tooth-structure'
const SUBSTRATE_FROM_FHIR: Partial<Record<string, ToothSubstrate>> = { ...invert(SUBSTRATE_TO_FHIR), [NATURAL_SUBSTRATE]: 'natural' }
const MATERIAL_FROM_FHIR = invert(MATERIAL_TO_FHIR)
const FILLING_FROM_FHIR = invert(FILLING_TO_FHIR)
const ENDO_FROM_FHIR = invert(ENDO_TO_FHIR)
const ROOT_POST_FROM_FHIR = invert(ROOT_POST_TO_FHIR)

function isComponent(component: ObservationComponent, componentCode: string): boolean {
  return component.code.coding?.some((coding) => coding.system === COMPONENT && coding.code === componentCode) ?? false
}

function componentValue(observation: Observation, componentCode: string): ObservationComponent | undefined {
  return observation.component?.find((c) => isComponent(c, componentCode))
}

function componentValues(observation: Observation, componentCode: string): ObservationComponent[] {
  return observation.component?.filter((c) => isComponent(c, componentCode)) ?? []
}

function chartValue(component: ObservationComponent | undefined): string | undefined {
  return component?.valueCodeableConcept?.coding?.find((c) => c.system === CHART_VALUE)?.code
}

function surfaces(component: ObservationComponent | undefined): Surface[] {
  const codes = (component?.extension ?? []).filter((e) => e.url === TOOTH_SURFACE_EXT).map((e) => e.valueCoding?.code ?? '')
  return [...new Set(codes.map((code) => FDI_SURFACE[code]).filter((s): s is Surface => Boolean(s)))]
}

/** Maps one dental-core tooth-state Observation to an upstream tooth record. */
export function toToothRecord(observation: Observation): ToothRecord {
  const record: ToothRecord = {}
  record.toothSelection = PRESENCE_FROM_FHIR[chartValue(componentValue(observation, 'tooth-presence')) ?? ''] ?? 'tooth-base'
  const substrate = SUBSTRATE_FROM_FHIR[chartValue(componentValue(observation, 'tooth-substrate')) ?? '']
  if (substrate) record.toothSubstrate = substrate
  const restorations = componentValues(observation, 'restoration-type')
  const materials = componentValues(observation, 'restoration-material')
  // A material without surfaces belongs to the crown or bridge; surface-bound materials to fillings.
  const material = chartValue(materials.find((m) => surfaces(m).length === 0) ?? materials[0])
  // A bridge unit next to a crown or partial restoration marks that tooth as a bridge abutment.
  const fixedRestorations = restorations.filter((r) => !['direct-filling', 'none'].includes(chartValue(r) ?? 'none'))
  const bridgeUnit = fixedRestorations.some((r) => chartValue(r) === 'bridge-unit')
  const fixed = fixedRestorations.find((r) => chartValue(r) !== 'bridge-unit') ?? fixedRestorations[0]
  const fixedType = chartValue(fixed)
  const abutment = bridgeUnit && isToothPresent(record) ? { bridgePillar: true } : {}
  if (isPartialRestoration(fixedType)) {
    Object.assign(record, { restorationType: fixedType, restorationMaterial: MATERIAL_FROM_FHIR[material ?? ''] ?? 'none', [`${fixedType}Coverage`]: surfaces(fixed) }, abutment)
  }
  switch (fixedType) {
    case 'crown':
      Object.assign(record, { toothSubstrate: record.toothSelection === 'implant' ? undefined : (substrate ?? 'crownprep'), restorationType: 'crown', restorationMaterial: MATERIAL_FROM_FHIR[material ?? ''] ?? 'metal-ceramic' }, abutment)
      break
    case 'telescopic-crown':
      // A telescopic bridge anchor reads as a bridge tooth with telescope material, as before.
      if (bridgeUnit) Object.assign(record, { restorationType: 'bridge', restorationMaterial: 'telescope', bridgePillar: isToothPresent(record) })
      else Object.assign(record, { toothSubstrate: substrate ?? 'crownprep', restorationType: 'crown', restorationMaterial: 'telescope' })
      break
    case 'bridge-unit':
      Object.assign(record, { restorationType: 'bridge', restorationMaterial: MATERIAL_FROM_FHIR[material ?? ''] ?? 'metal-ceramic', bridgePillar: isToothPresent(record) })
      break
  }
  const filling = restorations.find((r) => chartValue(r) === 'direct-filling')
  if (filling) {
    const filled = surfaces(filling)
    const materialOf = (surface: Surface): FillingMaterial =>
      FILLING_FROM_FHIR[chartValue(materials.find((m) => surfaces(m).includes(surface)) ?? materials[0]) ?? ''] ?? 'composite'
    record.fillingSurfaces = filled
    record.fillingSurfaceMaterials = Object.fromEntries(filled.map((s) => [s, materialOf(s)]))
  }
  const rootState = chartValue(componentValue(observation, 'root-endodontic-state')) ?? ''
  const post = ROOT_POST_FROM_FHIR[rootState]
  if (post) Object.assign(record, { endo: 'endo-filling', rootPostType: post })
  const endo = ENDO_FROM_FHIR[rootState]
  if (endo) record.endo = endo
  return record
}

function chartComponent(componentCode: string, valueCode: string, surfaceCodes: string[] = []): ObservationComponent {
  return {
    ...(surfaceCodes.length ? { extension: surfaceCodes.map((code): Extension => ({ url: TOOTH_SURFACE_EXT, valueCoding: { system: FDI_SURFACE_SYSTEM, code } })) } : {}),
    code: { coding: [{ system: COMPONENT, code: componentCode }] },
    valueCodeableConcept: { coding: [{ system: CHART_VALUE, code: valueCode }] },
  }
}

/** Incisors and canines (FDI position 1 to 3) have an incisal edge instead of an occlusal surface. */
function surfaceCode(tooth: string, surface: Surface): string {
  return surface === 'occlusal' && ['1', '2', '3'].includes(tooth.slice(-1)) ? 'I' : SURFACE_TO_FDI[surface]
}

/**
 * The inverse of toToothRecord: the dental-core tooth-state components of one upstream tooth
 * record. Only what the profile can carry is written; chart details without a dental-core
 * component (caries, mobility, wear, ...) stay in the chart.
 */
export function toToothStateComponents(tooth: string, record: ToothRecord): ObservationComponent[] {
  const selection = record.toothSelection ?? 'tooth-base'
  const components = [chartComponent('tooth-presence', PRESENCE_TO_FHIR[selection] ?? 'tooth-present')]
  const hasTooth = isToothPresent(record)
  const crowned = record.restorationType === 'crown' && record.toothSubstrate === 'natural'
  const substrate = hasTooth && selection !== 'implant' ? (crowned ? NATURAL_SUBSTRATE : SUBSTRATE_TO_FHIR[record.toothSubstrate ?? 'natural']) : undefined
  if (substrate) components.push(chartComponent('tooth-substrate', substrate))
  const material = record.restorationMaterial ?? 'none'
  const type = record.restorationType ?? 'none'
  if (type !== 'none') {
    // A telescope is a restoration type in dental-core, not a material; a telescopic bridge
    // anchor is a telescopic crown and a bridge unit.
    if (isPartialRestoration(type)) components.push(chartComponent('restoration-type', type, (record[`${type}Coverage`] ?? []).map((s) => surfaceCode(tooth, s))))
    else if (material === 'telescope') components.push(chartComponent('restoration-type', 'telescopic-crown'))
    else if (type === 'crown') components.push(chartComponent('restoration-type', 'crown'))
    // A bridge unit: a pontic, a bridge tooth, or a crown or partial restoration marked as abutment.
    if (type === 'bridge' || (hasTooth && record.bridgePillar)) components.push(chartComponent('restoration-type', 'bridge-unit'))
    const materialCode = MATERIAL_TO_FHIR[material]
    if (materialCode) components.push(chartComponent('restoration-material', materialCode))
  }
  const filled = hasTooth ? (record.fillingSurfaces ?? []) : []
  if (filled.length) {
    components.push(chartComponent('restoration-type', 'direct-filling', filled.map((s) => surfaceCode(tooth, s))))
    const byMaterial = new Map<string, string[]>()
    for (const surface of filled) {
      const code = FILLING_TO_FHIR[record.fillingSurfaceMaterials?.[surface] ?? 'composite'] ?? FILLING_TO_FHIR.composite
      byMaterial.set(code, [...(byMaterial.get(code) ?? []), surfaceCode(tooth, surface)])
    }
    for (const [code, surfaceCodes] of byMaterial) components.push(chartComponent('restoration-material', code, surfaceCodes))
  }
  // The profile allows one root-endodontic-state per tooth without a sub-tooth location
  // (invariant dental-repeated-endodontic-state-located). A post code stands for the post and the
  // complete root canal filling it sits in, as the chart's legacy values did; other combinations
  // are a gap (toothStateGap) and are not written.
  const post = hasTooth ? ROOT_POST_TO_FHIR[record.rootPostType ?? 'none'] : undefined
  const rootState = post ?? (hasTooth ? ENDO_TO_FHIR[record.endo ?? 'none'] : undefined)
  if (rootState) components.push(chartComponent('root-endodontic-state', rootState))
  return components
}

/**
 * Why a charted tooth cannot be written as a tooth-state Observation without losing data, or
 * undefined when it can. Such a tooth is refused instead of written coarser.
 */
export function toothStateGap(record: ToothRecord): string | undefined {
  if (!isToothPresent(record)) return undefined
  if (ROOT_POST_TO_FHIR[record.rootPostType ?? 'none'] && record.endo !== 'endo-filling') {
    return `a root post with endodontic state "${record.endo ?? 'none'}" does not fit the dental-tooth-state profile (one root-endodontic-state per tooth); only a post in a complete root canal filling can be saved`
  }
  if (record.endoResection) {
    return 'a root resection (apicoectomy) has no code in the dental-tooth-state profile; remove it to save the tooth'
  }
  if ((record.rootResection ?? 'none') !== 'none') {
    return `a root resection (${record.rootResection}) has no code in the dental-tooth-state profile; remove it to save the tooth`
  }
  return undefined
}

const HTEST: Coding = { system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'HTEST', display: 'test health data' }

/**
 * A new dental-core tooth-state Observation for one charted tooth, in the shape of the seeded
 * `dent-051-obs-tooth-chart-NN`. A change is always a new Observation with its own
 * effectiveDateTime; the previous one stays as history. `previous` (the tooth's latest
 * Observation) passes its performer on. Throws for a tooth the profile cannot carry
 * (toothStateGap).
 */
export function toToothState(patient: Patient, tooth: string, record: ToothRecord, effectiveDateTime: string, previous?: Observation): Omit<Observation, 'id'> {
  const gap = toothStateGap(record)
  if (gap) throw new Error(gap)
  return {
    resourceType: 'Observation',
    meta: { profile: [TOOTH_STATE_PROFILE], tag: [HTEST] },
    status: 'final',
    category: [{ coding: [{ system: 'https://fhir.cognovis.de/dental/CodeSystem/dental-category', code: 'dental', display: 'Dental' }] }],
    code: { coding: [{ system: COMPONENT, code: 'tooth-presence', display: 'Tooth presence' }], text: 'Tooth presence' },
    subject: { reference: `Patient/${patient.id}` },
    effectiveDateTime,
    ...(previous?.performer ? { performer: previous.performer } : {}),
    bodySite: { coding: [{ system: FDI_TOOTH_SYSTEM, code: tooth }], text: `FDI-Zahnposition ${tooth}` },
    component: toToothStateComponents(tooth, record),
  }
}

/**
 * The teeth of `after` whose tooth-state Observation would differ from the one of `before`.
 * Chart details the profile has no component for (see toToothStateComponents) are no change; a
 * change into or within a gap (toothStateGap) is, so it is reported and refused, not lost.
 */
export function changedTeeth(before: ChartTeeth, after: ChartTeeth): ChartTeeth {
  const signature = (tooth: string, record: ToothRecord | undefined) =>
    JSON.stringify([toToothStateComponents(tooth, record ?? {}), toothStateGap(record ?? {})])
  return Object.fromEntries(Object.entries(after).filter(([tooth, record]) => signature(tooth, before[tooth]) !== signature(tooth, record)))
}

/** The status chart: one record per tooth that has a tooth-state Observation. */
export function toChartStatus(toothStates: Observation[]): ChartTeeth {
  const teeth: ChartTeeth = {}
  for (const observation of toothStates) {
    const tooth = toothOf(observation.bodySite)
    if (tooth) teeth[tooth] = toToothRecord(observation)
  }
  return teeth
}

/**
 * The planned chart of one treatment alternative: the status chart with the effect of the
 * plan's GOZ activities applied to the teeth they reference (activity.detail.reasonReference
 * points to the tooth-state Observation). Only the GOZ numbers of the seeded plans are known;
 * extend PLANNED_EFFECT for your own plans.
 */
export function toPlanChart(status: ChartTeeth, carePlan: CarePlan, toothStates: Observation[]): ChartTeeth {
  const toothByObservation = new Map(toothStates.map((o) => [`Observation/${o.id}`, toothOf(o.bodySite)]))
  const plan: ChartTeeth = structuredClone(status)
  for (const activity of carePlan.activity ?? []) {
    const code = activity.detail?.code?.coding?.find((c) => c.system === GOZ)?.code
    const effect = code ? PLANNED_EFFECT[code] : undefined
    if (!effect) continue
    for (const reference of activity.detail?.reasonReference ?? []) {
      const tooth = toothByObservation.get(reference.reference ?? '')
      if (tooth) plan[tooth] = { ...plan[tooth], ...effect(plan[tooth] ?? {}) }
    }
  }
  // A pontic takes the material of the plan's bridge anchors.
  const anchorMaterial = Object.values(plan).find((t) => t.bridgePillar)?.restorationMaterial
  for (const tooth of Object.values(plan)) {
    if (tooth.restorationType === 'bridge' && !tooth.bridgePillar && anchorMaterial) tooth.restorationMaterial = anchorMaterial
  }
  return plan
}

const REMOVABLE_PARTIAL: ToothRecord = { toothSelection: 'none', prosthesis: 'removable-partial', restorationType: 'none', restorationMaterial: undefined, bridgePillar: false }

const PLANNED_EFFECT: Record<string, (current: ToothRecord) => ToothRecord> = {
  // 5000 bridge anchor, full crown (tangential preparation): full-cast gold bridge
  '5000': () => ({ toothSubstrate: 'crownprep', restorationType: 'crown', restorationMaterial: 'gold', bridgePillar: true, fillingSurfaces: [], fillingSurfaceMaterials: {} }),
  // 5010 bridge anchor, full crown (chamfer/shoulder preparation): veneered bridge
  '5010': () => ({ toothSubstrate: 'crownprep', restorationType: 'crown', restorationMaterial: 'metal-ceramic', bridgePillar: true, fillingSurfaces: [], fillingSurfaceMaterials: {} }),
  // 5070 bridge span: pontic in the gap (material follows the anchors, see toPlanChart)
  '5070': () => ({ restorationType: 'bridge', restorationMaterial: 'metal-ceramic' }),
  // 9010 implant insertion
  '9010': () => ({ toothSelection: 'implant' }),
  // 2200 full crown (on the implant in the seeded plan)
  '2200': (current) => ({ restorationType: 'crown', restorationMaterial: 'metal-ceramic', toothSubstrate: current.toothSelection === 'implant' ? undefined : 'crownprep' }),
  // 5200 partial denture with bent clasps, 5210 cast partial denture: the missing tooth is replaced
  // by a removable denture tooth. The chart draws it only on an absent tooth position without a
  // fixed restoration, so a bridge pontic recorded there is replaced.
  '5200': () => REMOVABLE_PARTIAL,
  '5210': () => REMOVABLE_PARTIAL,
}
