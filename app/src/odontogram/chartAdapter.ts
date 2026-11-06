// INTEGRATION POINT: odontogram adapter.
//
// The starter app draws the chart with the public MIT upstream `react-advanced-odontogram`
// (https://github.com/ZoliQua/React-Advanced-Odontogram, npm 2.8.0). Every FHIR-to-chart
// decision lives in this folder, so a team can swap the chart component (for example the
// cognovis fork, once it is published) by replacing this module and `OdontogramView.tsx`,
// keeping the rest of the app as it is.
//
// The contract the rest of the app relies on:
//   toChartStatus(toothStates)            dental-core tooth-state Observations -> status chart
//   toPlanChart(status, carePlan, states) one CarePlan alternative -> planned chart
//
// The chart payload follows the upstream `importStatus()` JSON: { version, teeth, plan? },
// keyed by FDI tooth number. Only the fields this mapping sets are typed here.

import type { CarePlan, Observation, ObservationComponent } from '../fhir'
import { toothOf } from '../fhir'

const CHART_VALUE = 'https://fhir.cognovis.de/dental-core/CodeSystem/dental-chart-value'
const COMPONENT = 'https://fhir.cognovis.de/dental-core/CodeSystem/dental-component'
const TOOTH_SURFACE_EXT = 'https://fhir.cognovis.de/dental-core/StructureDefinition/tooth-surface'
const GOZ = 'http://fhir.de/CodeSystem/bzaek/goz'

type Surface = 'buccal' | 'lingual' | 'mesial' | 'distal' | 'occlusal'
type FillingMaterial = 'amalgam' | 'composite' | 'gic' | 'temporary'

export interface ToothRecord {
  toothSelection?: 'none' | 'tooth-base' | 'milktooth' | 'implant'
  toothSubstrate?: 'natural' | 'crownprep'
  restorationType?: 'none' | 'crown' | 'bridge'
  restorationMaterial?: 'none' | 'gold' | 'metal-ceramic' | 'telescope' | 'zircon'
  bridgePillar?: boolean
  fillingSurfaces?: Surface[]
  fillingSurfaceMaterials?: Partial<Record<Surface, FillingMaterial>>
  endo?: 'none' | 'endo-filling'
}

export type ChartTeeth = Record<string, ToothRecord>

export interface ChartPayload {
  version: string
  teeth: ChartTeeth
  plan?: ChartTeeth
}

// The upstream payload version this mapping was written against (react-advanced-odontogram 2.8).
export const PAYLOAD_VERSION = '2.3'

const FDI_SURFACE: Record<string, Surface> = { M: 'mesial', O: 'occlusal', I: 'occlusal', D: 'distal', B: 'buccal', V: 'buccal', L: 'lingual', P: 'lingual' }

function componentValue(observation: Observation, componentCode: string): ObservationComponent | undefined {
  return observation.component?.find((c) => c.code.coding?.some((coding) => coding.system === COMPONENT && coding.code === componentCode))
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
  switch (chartValue(componentValue(observation, 'tooth-presence'))) {
    case 'tooth-absent': record.toothSelection = 'none'; break
    case 'primary-tooth-present': record.toothSelection = 'milktooth'; break
    case 'implant-in-tooth-position': record.toothSelection = 'implant'; break
    default: record.toothSelection = 'tooth-base'
  }
  const restoration = componentValue(observation, 'restoration-type')
  const material = chartValue(componentValue(observation, 'restoration-material'))
  switch (chartValue(restoration)) {
    case 'crown':
      Object.assign(record, { toothSubstrate: record.toothSelection === 'implant' ? undefined : 'crownprep', restorationType: 'crown', restorationMaterial: material === 'gold-alloy' ? 'gold' : 'metal-ceramic' })
      break
    case 'telescopic-crown':
      Object.assign(record, { toothSubstrate: 'crownprep', restorationType: 'crown', restorationMaterial: 'telescope' })
      break
    case 'bridge-unit':
      Object.assign(record, { restorationType: 'bridge', restorationMaterial: 'metal-ceramic', bridgePillar: record.toothSelection !== 'none' })
      break
    case 'direct-filling': {
      const fillingMaterial: FillingMaterial = material === 'amalgam' ? 'amalgam' : 'composite'
      const filled = surfaces(restoration)
      record.fillingSurfaces = filled
      record.fillingSurfaceMaterials = Object.fromEntries(filled.map((s) => [s, fillingMaterial]))
      break
    }
  }
  if (chartValue(componentValue(observation, 'root-endodontic-state')) === 'root-canal-filling') record.endo = 'endo-filling'
  return record
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
}
