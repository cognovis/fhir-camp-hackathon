// Cost plans priced by the Billing SDK. The dev server runs billing/cost-plan.mjs and serves its
// JSON at /api/cost-plan (see vite.config.ts); the SDK does not run in the browser.

import type { ChargeItem } from './fhir'

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
  if (!response.ok) throw new Error(`Billing check failed: ${(body as { error?: string }).error ?? `HTTP ${response.status}`}`)
  return body as CostPlan[]
}

// Writes the justification for a raised multiplier into ChargeItem.reason (GOZ § 10) and keeps
// the rest of the resource, including its HTEST tag, as it is.
export async function saveJustification(chargeItemId: string, text: string): Promise<ChargeItem> {
  const url = `/fhir/ChargeItem/${encodeURIComponent(chargeItemId)}`
  const current = await fetch(url, { headers: { accept: 'application/fhir+json' } })
  if (!current.ok) throw new Error(`GET ChargeItem/${chargeItemId}: HTTP ${current.status}`)
  const item = (await current.json()) as ChargeItem
  const updated: ChargeItem = { ...item, reason: [{ text: text.trim() }] }
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/fhir+json', accept: 'application/fhir+json' },
    body: JSON.stringify(updated),
  })
  if (!response.ok) throw new Error(`PUT ChargeItem/${chargeItemId}: HTTP ${response.status}`)
  return (await response.json()) as ChargeItem
}

export const DECISIONS: Record<string, { label: string; tone: 'ok' | 'review' | 'bad' }> = {
  allow: { label: 'Allow', tone: 'ok' },
  unavailable: { label: 'Needs review', tone: 'review' },
  block: { label: 'Block', tone: 'bad' },
}

// Readable text for the findings of the kit's rule set (billing/goz-hackathon-rules.json).
export function findingText(finding: CostPlanFinding, line?: CostPlanLine): string {
  if (finding.message) return finding.message
  switch (finding.code) {
    case 'MULTIPLIER_JUSTIFICATION_REQUIRED':
      return `Multiplier ${line ? line.factor.toFixed(1) : 'above 2.3'} needs a justification${line ? ` (GOZ ${line.code}${line.tooth ? `, tooth ${line.tooth}` : ''})` : ''}`
    case 'MULTIPLIER_OUT_OF_BOUNDS':
      return `Multiplier ${line ? line.factor.toFixed(1) : ''} is outside 1.0 to 3.5`
    case 'QUANTITY_CAP_EXCEEDED':
      return `GOZ ${line?.code ?? ''} is billed more often than allowed`
    case 'MUTUALLY_EXCLUSIVE_CODE_PRESENT':
      return `GOZ ${line?.code ?? ''} cannot be billed together with another planned service`
    default:
      return finding.code
  }
}

export const euro = (value: number | null | undefined) =>
  value == null ? '–' : value.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
