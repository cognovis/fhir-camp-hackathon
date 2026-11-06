// Cost plans priced by the Billing SDK. The dev server runs billing/cost-plan.mjs and serves its
// JSON at /api/cost-plan (see vite.config.ts); the SDK does not run in the browser.

import { fhirRequest, type ChargeItem } from './fhir'

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
  if (!response.ok) throw new Error(`Billing check failed: ${(body as { error?: string }).error ?? `HTTP ${response.status}`}`)
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

export const DECISIONS: Record<string, { label: string; tone: 'ok' | 'review' | 'bad' }> = {
  allow: { label: 'Keine offenen Prüfhinweise', tone: 'ok' },
  unavailable: { label: 'Angaben prüfen', tone: 'review' },
  block: { label: 'Regelverstoß', tone: 'bad' },
}

const FACT_LABELS: Record<string, string> = {
  ownServiceConfirmed: 'Zuordnung zur eigenen geplanten Leistung', contentConfirmed: 'geplanter Leistungsinhalt',
  indication: 'Indikation', episodeId: 'Behandlungsfall', scopeComplete: 'Vollständigkeit des geprüften Plans',
  historyComplete: 'Vollständigkeit der relevanten Vorgeschichte', eventId: 'Behandlungsschritt',
  targetId: 'Behandlungsziel', sessionId: 'Sitzung', planningObjectId: 'Zuordnung zum Heil- und Kostenplan',
  restorationId: 'Zuordnung zur Versorgung', unitKind: 'Abrechnungseinheit', unitIds: 'betroffene Zähne, Implantate oder Spannen',
  findingsRecorded: 'dokumentierter Befund', writtenPlan: 'schriftlicher Heil- und Kostenplan',
  supportKind: 'natürlicher Zahn oder Implantat', implantSystem: 'Implantatsystem', implantId: 'Implantatidentität',
  provisionalId: 'Identität des Provisoriums', provisionalAction: 'Art der Provisoriumsleistung',
  provisionalOrigin: 'Herkunft des Provisoriums', impressionTaken: 'Abformung', priorProvisionalBilled: 'Vorabrechnung des Provisoriums',
  agreementStatus: 'Status einer Honorarvereinbarung', justificationConfirmed: 'bestätigte individuelle Erschwernis',
  implantAnalysisConfirmed: 'dokumentierte Implantatanalyse', orientationTemplateUsed: 'Verwendung der Orientierungsschablone',
  implantExposureConfirmed: 'geplante Freilegung', abutmentInsertionConfirmed: 'geplantes Einfügen der Aufbauelemente',
  phaseId: 'Behandlungsphase', phase: 'Art der Behandlungsphase',
}

// These explain the checked rules; they do not decide eligibility or replace the FHIR evidence.
export const RULE_EXPLANATIONS: Record<string, string> = {
  'goz-5010-supportKind': 'GOZ 5010 ist in dieser Regelprüfung einem natürlichen Pfeilerzahn zugeordnet und nicht auf einem Implantat berechnungsfähig.',
  'goz-9040-implantSystem': 'GOZ 9040 setzt ein zweiphasiges Implantatsystem voraus. Ohne diese Angabe ist die Prüfung offen.',
  'GOZ-G01': 'Der Gebührenfaktor wird gegen den Gebührenrahmen und gegebenenfalls eine dokumentierte Honorarvereinbarung geprüft.',
  'GOZ-G02': 'Ein Faktor über 2,3 erfordert eine individuelle Begründung; dokumentierte Honorarvereinbarungen werden gesondert berücksichtigt.',
  'GOZ-G03': 'Die Gebühr wird aus Punktzahl, Punktwert und Faktor berechnet und auf Cent gerundet.',
  'GOZ-G04': 'Geprüft werden die Zuordnung zur eigenen Leistung, der dokumentierte Leistungsinhalt und die Indikation.',
  'GOZ-0030-content': 'Zum Heil- und Kostenplan müssen Befund und schriftlicher Plan dokumentiert sein.',
  'GOZ-0030-exclusion': 'GOZ 0030 und 0040 werden auf einen Ausschluss für denselben Planungsgegenstand geprüft.',
  'GOZ-0090-repeat': 'Mehrfache Anästhesieleistungen am selben Behandlungsziel in derselben Sitzung benötigen eine individuelle Begründung.',
  'GOZ-2200-exclusion': 'Füllungs- und Kronenleistungen werden im selben Versorgungskontext auf Ausschlüsse geprüft.',
  'GOZ-2200-included': 'Bereits in der Kronenleistung enthaltene Teilleistungen dürfen nicht nochmals separat berechnet werden.',
  'GOZ-5000-included': 'Bereits im Brückenanker enthaltene Teilleistungen werden auf Doppelberechnung geprüft.',
  'GOZ-5010-included': 'Bereits im Brückenanker enthaltene Teilleistungen werden auf Doppelberechnung geprüft.',
  'GOZ-9010-included': 'Bereits in der Implantation enthaltene Teilleistungen werden auf Doppelberechnung geprüft.',
  'GOZ-2200-units': 'Die Anzahl der Kronen muss zu den eindeutig bezeichneten Zähnen oder Implantaten passen.',
  'GOZ-anchor-units': 'Brückenanker werden anhand der eindeutig bezeichneten Pfeiler gezählt.',
  'GOZ-5070-units': 'Brückenspannen oder Freiendsättel müssen einzeln zugeordnet sein und zur berechneten Menge passen.',
  'GOZ-5120-units': 'Die Menge der provisorischen Versorgung muss zu den bezeichneten Zähnen oder Implantaten passen.',
  'GOZ-5140-units': 'Die Menge muss zu den bezeichneten provisorischen Spannen oder Freiendsätteln passen.',
  'GOZ-jaw-units': 'Analyse und Schablonenleistung müssen dem jeweiligen Kiefer zugeordnet sein.',
  'GOZ-9010-units': 'Die Menge der Implantationen muss zu den eindeutig bezeichneten Implantaten passen.',
  'GOZ-provisional': 'Herstellung, Abformung und Identität des Provisoriums werden geprüft; Wiederbefestigung oder Entfernung können bereits enthalten sein.',
  'GOZ-9000-content': 'Die Implantatanalyse muss mit ihrem erforderlichen Inhalt dokumentiert sein.',
  'GOZ-9003-content': 'Die Verwendung der Orientierungsschablone muss dokumentiert sein.',
  'GOZ-9040-content': 'Freilegung und Einfügen von Aufbauelementen müssen zum dokumentierten Leistungsinhalt gehören.',
  'GOZ-9050-context': 'GOZ 9050 wird je Implantat, Sitzung und rekonstruktiver Phase auf Häufigkeit und Ausschlüsse geprüft.',
}

export const findingExplanation = (finding: CostPlanFinding) => {
  const violation = finding.effect === 'reject'
  const rawFields = finding.code === 'REQUIRED_FACT_UNAVAILABLE'
    ? [finding.details?.fact?.split('|').at(-1) ?? '']
    : finding.message?.startsWith('Missing or conflicting facts: ')
      ? finding.message.slice('Missing or conflicting facts: '.length).split(', ')
      : []
  const fields = rawFields.filter(Boolean).map((key) => FACT_LABELS[key] ?? 'weitere strukturierte Nachweise')
  const rule = RULE_EXPLANATIONS[finding.rule ?? ''] ?? 'Diese Prüfung konnte mit den vorhandenen Daten nicht abschließend durchgeführt werden.'
  let summary = violation ? 'Die dokumentierten Angaben widersprechen der geprüften Regel.' : 'Für die Prüfung fehlen eindeutige Angaben.'
  let action = violation ? 'Leistungsansatz und Dokumentation prüfen und korrigieren; danach erneut prüfen.' : 'Fehlende oder widersprüchliche Angaben im FHIR-Behandlungsplan ergänzen; danach erneut prüfen.'
  if (fields.length) summary = `Nicht eindeutig dokumentiert: ${fields.join(', ')}.`
  if (finding.rule === 'goz-9040-implantSystem' && !violation) action = 'Implantatsystem anhand der Behandlungsunterlagen dokumentieren und den Nachweis mit GOZ 9040 verknüpfen; danach erneut prüfen.'
  if (finding.rule === 'goz-5010-supportKind' && !violation) action = 'Dokumentieren, ob der Pfeiler ein natürlicher Zahn oder ein Implantat ist; danach erneut prüfen.'
  if (finding.code === 'GOZ_JUSTIFICATION_REQUIRED' || finding.code === 'MULTIPLIER_JUSTIFICATION_REQUIRED') {
    summary = 'Die individuelle schriftliche Begründung für den erhöhten Faktor fehlt oder ist nicht ausreichend bestätigt.'
    action = 'Individuelle Erschwernis dokumentieren und die Begründung zur Leistung speichern. Eine Freitexteingabe ersetzt keine fehlende fachliche Bestätigung.'
  }
  if (finding.code === 'ACCOMPANYING_INFORMATION_REQUIRED') summary = 'Die dokumentierte Art des Pfeilers oder Implantatsystems erfüllt die Voraussetzung dieser Leistung nicht.'
  if (finding.code === 'GOZ_UNIT_QUANTITY_MISMATCH') summary = 'Die berechnete Menge passt nicht zur Anzahl der eindeutig zugeordneten Versorgungseinheiten.'
  if (finding.code === 'GOZ_COMPONENT_ALREADY_INCLUDED' || finding.code === 'GOZ_PROVISIONAL_ALREADY_INCLUDED') summary = 'Diese Leistung ist laut dokumentiertem Zusammenhang bereits in einer anderen Leistung enthalten.'
  if (finding.code === 'GOZ_IMPRESSION_REQUIRED') summary = 'Die für diese provisorische Versorgung erforderliche Abformung ist ausdrücklich verneint.'
  if (finding.code === 'GOZ_LIBRARY_UNAVAILABLE' || finding.code === 'GOZ_LEGAL_SNAPSHOT_UNREVIEWED' || finding.code === 'SNAPSHOT_MALFORMED') {
    summary = 'Die Prüfung ist technisch oder für diesen Prüfzeitpunkt nicht verfügbar.'
    action = 'Prüfgrundlagen und technische Details prüfen lassen. Daraus folgt kein nachgewiesener Abrechnungsverstoß.'
  }
  return { kind: violation ? 'Regelverstoß' : 'Prüfbedarf', summary, rule, action }
}

export function findingText(finding: CostPlanFinding, line?: CostPlanLine): string {
  const position = line ? `GOZ ${line.code}${line.tooth ? ` · Zahn ${line.tooth}` : ''} · Faktor ${line.factor.toLocaleString('de-DE')}: ` : ''
  return position + findingExplanation(finding).summary
}

export const euro = (value: number | null | undefined) =>
  value == null ? '–' : value.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
