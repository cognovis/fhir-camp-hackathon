import { t, number, type TranslationKey } from './i18n.ts'
// Cost plans priced by the Billing SDK. The dev server runs billing/cost-plan.mjs and serves its
// JSON at /api/cost-plan (see vite.config.ts); the SDK does not run in the browser.

import { fhirRequest, type ChargeItem } from './fhir.ts'

export interface CostPlanLine {
  id: string // the ChargeItem id
  code: string // GOZ number
  display: string
  tooth: string
  quantity: number
  factor: number
  points?: number
  unitPrice?: number
  amount?: number
}

export interface CostPlanFinding {
  code: string
  message?: string
  rule?: string
  line?: string // the ChargeItem id the finding is about
  effect?: string
  details?: { fact?: string }
  sources?: { citation?: string; uri?: string }[]
}

export type Decision = 'allow' | 'unavailable' | 'block' | string

export interface CostPlan {
  account: string
  name?: string
  decision: Decision
  findings: CostPlanFinding[]
  lines: CostPlanLine[]
  total: number | null
}

export async function loadCostPlans(patientId: string): Promise<CostPlan[]> {
  const response = await fetch(`/api/cost-plan?patient=${encodeURIComponent(patientId)}`)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(t('billingError', { detail: (body as { error?: string }).error ?? `HTTP ${response.status}` }))
  return body as CostPlan[]
}

// Writes the justification for a raised multiplier into ChargeItem.reason (GOZ § 10) and keeps
// the rest of the resource, including its HTEST tag and any coded reasons, as it is. The
// justification is the one text-only reason; saving again replaces it.
export async function saveJustification(chargeItemId: string, text: string): Promise<ChargeItem> {
  const path = `ChargeItem/${encodeURIComponent(chargeItemId)}`
  const current = await fhirRequest<ChargeItem>('GET', path)
  if (current.status >= 400 || !current.body) throw new Error(`GET ChargeItem/${chargeItemId}: HTTP ${current.status}`)
  const item = current.body
  const coded = (item.reason ?? []).filter((reason) => reason.coding?.length)
  const updated: ChargeItem = { ...item, reason: [...coded, { text: text.trim() }] }
  const response = await fhirRequest<ChargeItem>('PUT', path, updated)
  if (response.status >= 400 || !response.body) throw new Error(`PUT ChargeItem/${chargeItemId}: HTTP ${response.status}`)
  return response.body
}

export const DECISIONS: Record<string, { label: TranslationKey; tone: 'ok' | 'review' | 'bad' }> = {
  allow: { label: 'allow', tone: 'ok' },
  unavailable: { label: 'unavailable', tone: 'review' },
  block: { label: 'block', tone: 'bad' },
}

const FACT_LABELS: Record<string, TranslationKey> = {
  'ownServiceConfirmed': 'fact.ownServiceConfirmed',
  'contentConfirmed': 'fact.contentConfirmed',
  'indication': 'fact.indication',
  'episodeId': 'fact.episodeId',
  'scopeComplete': 'fact.scopeComplete',
  'historyComplete': 'fact.historyComplete',
  'eventId': 'fact.eventId',
  'targetId': 'fact.targetId',
  'sessionId': 'fact.sessionId',
  'planningObjectId': 'fact.planningObjectId',
  'restorationId': 'fact.restorationId',
  'unitKind': 'fact.unitKind',
  'unitIds': 'fact.unitIds',
  'findingsRecorded': 'fact.findingsRecorded',
  'writtenPlan': 'fact.writtenPlan',
  'supportKind': 'fact.supportKind',
  'implantSystem': 'fact.implantSystem',
  'implantId': 'fact.implantId',
  'provisionalId': 'fact.provisionalId',
  'provisionalAction': 'fact.provisionalAction',
  'provisionalOrigin': 'fact.provisionalOrigin',
  'impressionTaken': 'fact.impressionTaken',
  'priorProvisionalBilled': 'fact.priorProvisionalBilled',
  'agreementStatus': 'fact.agreementStatus',
  'justificationConfirmed': 'fact.justificationConfirmed',
  'implantAnalysisConfirmed': 'fact.implantAnalysisConfirmed',
  'orientationTemplateUsed': 'fact.orientationTemplateUsed',
  'implantExposureConfirmed': 'fact.implantExposureConfirmed',
  'abutmentInsertionConfirmed': 'fact.abutmentInsertionConfirmed',
  'phaseId': 'fact.phaseId',
  'phase': 'fact.phase',
}

// These explain the checked rules; they do not decide eligibility or replace the FHIR evidence.
export const RULE_EXPLANATIONS: Record<string, TranslationKey> = {
  'goz-5010-supportKind': 'rule.goz-5010-supportKind',
  'goz-9040-implantSystem': 'rule.goz-9040-implantSystem',
  'GOZ-G01': 'rule.GOZ-G01',
  'GOZ-G02': 'rule.GOZ-G02',
  'GOZ-G03': 'rule.GOZ-G03',
  'GOZ-G04': 'rule.GOZ-G04',
  'GOZ-0030-content': 'rule.GOZ-0030-content',
  'GOZ-0030-exclusion': 'rule.GOZ-0030-exclusion',
  'GOZ-0090-repeat': 'rule.GOZ-0090-repeat',
  'GOZ-2200-exclusion': 'rule.GOZ-2200-exclusion',
  'GOZ-2200-included': 'rule.GOZ-2200-included',
  'GOZ-5000-included': 'rule.GOZ-5000-included',
  'GOZ-5010-included': 'rule.GOZ-5010-included',
  'GOZ-9010-included': 'rule.GOZ-9010-included',
  'GOZ-2200-units': 'rule.GOZ-2200-units',
  'GOZ-anchor-units': 'rule.GOZ-anchor-units',
  'GOZ-5070-units': 'rule.GOZ-5070-units',
  'GOZ-5120-units': 'rule.GOZ-5120-units',
  'GOZ-5140-units': 'rule.GOZ-5140-units',
  'GOZ-jaw-units': 'rule.GOZ-jaw-units',
  'GOZ-9010-units': 'rule.GOZ-9010-units',
  'GOZ-provisional': 'rule.GOZ-provisional',
  'GOZ-9000-content': 'rule.GOZ-9000-content',
  'GOZ-9003-content': 'rule.GOZ-9003-content',
  'GOZ-9040-content': 'rule.GOZ-9040-content',
  'GOZ-9050-context': 'rule.GOZ-9050-context',
}

export const findingExplanation = (finding: CostPlanFinding) => {
  const violation = finding.effect === 'reject'
  const rawFields = finding.code === 'REQUIRED_FACT_UNAVAILABLE'
    ? [finding.details?.fact?.split('|').at(-1) ?? '']
    : finding.message?.startsWith('Missing or conflicting facts: ')
      ? finding.message.slice('Missing or conflicting facts: '.length).split(', ')
      : []
  const fields = rawFields.filter(Boolean).map((key) => t(FACT_LABELS[key] ?? 'otherFacts'))
  const rule = t(RULE_EXPLANATIONS[finding.rule ?? ''] ?? 'unknownRule')
  let summary = violation ? t('violationSummary') : t('missingSummary')
  let action = violation ? t('violationAction') : t('missingAction')
  if (fields.length) summary = t('missingFields', { fields: fields.join(', ') })
  if (finding.rule === 'goz-9040-implantSystem' && !violation) action = t('implantAction')
  if (finding.rule === 'goz-5010-supportKind' && !violation) action = t('supportAction')
  if (finding.code === 'GOZ_JUSTIFICATION_REQUIRED' || finding.code === 'MULTIPLIER_JUSTIFICATION_REQUIRED') {
    summary = t('justificationSummary')
    action = t('justificationAction')
  }
  if (finding.code === 'ACCOMPANYING_INFORMATION_REQUIRED') summary = t('companionSummary')
  if (finding.code === 'GOZ_UNIT_QUANTITY_MISMATCH') summary = t('quantitySummary')
  if (finding.code === 'GOZ_COMPONENT_ALREADY_INCLUDED' || finding.code === 'GOZ_PROVISIONAL_ALREADY_INCLUDED') summary = t('includedSummary')
  if (finding.code === 'GOZ_IMPRESSION_REQUIRED') summary = t('impressionSummary')
  if (finding.code === 'GOZ_LIBRARY_UNAVAILABLE' || finding.code === 'GOZ_LEGAL_SNAPSHOT_UNREVIEWED' || finding.code === 'SNAPSHOT_MALFORMED') {
    summary = t('technicalSummary')
    action = t('technicalAction')
  }
  return { kind: violation ? t('block') : t('reviewNeed'), summary, rule, action }
}

export function findingText(finding: CostPlanFinding, line?: CostPlanLine): string {
  const position = line ? t('positionPrefix', { code: line.code, tooth: line.tooth ? t('positionTooth', { tooth: line.tooth }) : '', factor: number(line.factor, { minimumFractionDigits: 1 }) }) : ''
  return position + findingExplanation(finding).summary
}

export const euro = (value: number | null | undefined) =>
  value == null ? '–' : number(value, { style: 'currency', currency: 'EUR' })
