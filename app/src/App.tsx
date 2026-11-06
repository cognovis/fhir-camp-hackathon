import { useTranslation } from 'react-i18next'
import { t, date, number } from './i18n.ts'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { DECISIONS, euro, findingExplanation, findingText, loadCostPlans, saveJustification, type CostPlan, type CostPlanLine } from './costPlan'
import { display, loadPatientRecord, patientName, search, type CarePlan, type ChargeItem, type Patient, type PatientRecord } from './fhir'
import { toChartStatus, toPlanChart } from './odontogram/chartAdapter'
import { OdontogramView } from './odontogram/OdontogramView'
import { downloadPatient, downloadPlan } from './download'
import { createPlan, deletePlan } from './plans'

const DENTAL_PATIENT = 'https://github.com/cognovis/fhir-camp-hackathon/sid/patient'

// Status: the current chart only. Plan: the alternatives, each on the chart, or all side by side.
type Mode = 'status' | 'plan'
const COMPARE = 'compare'

export function App() {
  useTranslation()
  const [patients, setPatients] = useState<Patient[]>([])
  const [patientId, setPatientId] = useState<string>()
  const [record, setRecord] = useState<PatientRecord>()
  const [mode, setMode] = useState<Mode>('status')
  const [planView, setPlanView] = useState<string>() // a CarePlan id or COMPARE
  const [costPlans, setCostPlans] = useState<CostPlan[]>()
  const [costPlanError, setCostPlanError] = useState<string>()
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    search<Patient>(`Patient?identifier=${encodeURIComponent(`${DENTAL_PATIENT}|`)}&_sort=_id&_count=50`)
      .then((list) => { setPatients(list); setPatientId((current) => current ?? list.find((p) => p.id === 'dent-051')?.id ?? list[0]?.id) })
      .catch((e: Error) => setError(`${e.message}. ${t('aidboxHint')}`))
  }, [])

  useEffect(() => {
    const patient = patients.find((p) => p.id === patientId)
    if (!patient) return
    setRecord(undefined)
    setMode('status')
    setPlanView(undefined)
    setCostPlans(undefined)
    setCostPlanError(undefined)
    // Ignore the answer of a load that a newer patient selection has superseded.
    let current = true
    loadPatientRecord(patient)
      .then((loaded) => { if (current) setRecord(loaded) })
      .catch((e: Error) => { if (current) setError(e.message) })
    setChecking(true)
    loadCostPlans(patient.id)
      .then((plans) => { if (current) setCostPlans(plans) })
      .catch((e: Error) => { if (current) setCostPlanError(e.message) })
      .finally(() => { if (current) setChecking(false) })
    return () => { current = false }
  }, [patients, patientId])

  const recheck = useCallback(async () => {
    if (!patientId) return
    setChecking(true)
    setCostPlanError(undefined)
    try { setCostPlans(await loadCostPlans(patientId)) } catch (e) { setCostPlanError((e as Error).message) } finally { setChecking(false) }
  }, [patientId])

  // Save the justification, then run the billing check again on what Aidbox now holds.
  const justify = useCallback(async (chargeItemId: string, text: string) => {
    const saved = await saveJustification(chargeItemId, text)
    setRecord((r) => (r ? { ...r, chargeItems: r.chargeItems.map((c) => (c.id === saved.id ? saved : c)) } : r))
    await recheck()
  }, [recheck])

  // Write a new alternative (blank, or a copy of `source` with its cost plan), then reload and show it.
  const addPlan = useCallback(async (source?: CarePlan) => {
    if (!record) return
    const created = await createPlan(record.patient, record.carePlans, record.chargeItems, source)
    setRecord(await loadPatientRecord(record.patient))
    setPlanView(created.id)
    await recheck()
  }, [record, recheck])

  // Delete an alternative with its cost plan, then show the chosen one again.
  const removePlan = useCallback(async (carePlan: CarePlan) => {
    if (!record) return
    if (!window.confirm(t('confirmDelete', { name: carePlan.title ?? carePlan.id }))) return
    await deletePlan(carePlan, record.chargeItems)
    setRecord(await loadPatientRecord(record.patient))
    setPlanView((current) => (current === COMPARE ? COMPARE : undefined))
    await recheck()
  }, [record, recheck])

  // The alternative on screen: the one picked, else the one the patient chose, else the first.
  const carePlans = record?.carePlans ?? []
  const compare = mode === 'plan' && planView === COMPARE
  const selectedPlan = mode === 'plan' && !compare
    ? carePlans.find((p) => p.id === planView) ?? carePlans.find((p) => p.intent === 'plan') ?? carePlans[0]
    : undefined

  const status = useMemo(() => (record ? toChartStatus(record.toothStates) : undefined), [record])
  const plan = useMemo(
    () => (record && status && selectedPlan ? toPlanChart(status, selectedPlan, record.toothStates) : undefined),
    [record, status, selectedPlan],
  )
  const costPlanOf = useMemo(() => {
    const byCarePlan = new Map<string, CostPlan>()
    if (!record || !costPlans) return byCarePlan
    for (const carePlan of record.carePlans) {
      const account = accountOf(carePlan, record.chargeItems)
      const costPlan = costPlans.find((c) => c.account === account)
      if (costPlan) byCarePlan.set(carePlan.id, costPlan)
    }
    return byCarePlan
  }, [record, costPlans])

  const patient = record?.patient
  const chartDate = record?.toothStates[0]?.effectiveDateTime ?? ''

  return (
    <div className="app-page">
      <div className="appbar">
        <ToothIcon />
        <div>
          <div className="appbar-title">{t('appTitle')}</div>
          <div className="appbar-sub">{t('appSubtitle')}</div>
        </div>
        <label className="patient-select">
          <span>{t('patient')}</span>
          <select value={patientId ?? ''} onChange={(e) => setPatientId(e.target.value)}>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>{patientName(p)} ({p.id})</option>
            ))}
          </select>
        </label>
      </div>

      <main className="content">
        {error && <p className="error">{error}</p>}

        {patient && <PatientCard patient={patient} mode={mode} onMode={setMode} />}

        {record && status && (
          <section className="app-card plans-card" aria-label={mode === 'plan' ? t('plansAndChart') : t('chart')}>
            {mode === 'plan' && (
              <div className="plan-nav">
                <div className="plan-nav-head">
                  <div>
                    <div className="section-title">{t('plans')}</div>
                    <div className="muted">{t('plansIntro', { name: patient?.name?.[0]?.given?.[0] ?? patientName(record.patient) })}</div>
                  </div>
                  <div className="plan-nav-actions">
                    {selectedPlan && carePlans.length > 1 && (
                      <PlanStepper
                        index={carePlans.indexOf(selectedPlan)}
                        count={carePlans.length}
                        onStep={(i) => setPlanView(carePlans[i].id)}
                      />
                    )}
                    <button type="button" className="secondary" onClick={recheck} disabled={checking}>{checking ? t('checking') : t('recheck')}</button>
                    <AddPlanMenu activePlan={selectedPlan} onAdd={addPlan} />
                  </div>
                </div>
                <div role="tablist" aria-label={t('plans')} className="tabs">
                  {carePlans.map((carePlan) => {
                    const costPlan = costPlanOf.get(carePlan.id)
                    return (
                      <Tab
                        key={carePlan.id}
                        selected={carePlan.id === selectedPlan?.id}
                        onClick={() => setPlanView(carePlan.id)}
                        name={shortTitle(carePlan)}
                        badge={<PlanBadge carePlan={carePlan} />}
                        meta={costPlan ? `${t('services', { count: costPlan.lines.length })} · ${euro(costPlan.total)}` : t('activities', { count: carePlan.activity?.length ?? 0 })}
                      />
                    )
                  })}
                  {carePlans.length > 0 && (
                    <>
                      <div className="tab-sep" aria-hidden="true" />
                      <Tab selected={compare} onClick={() => setPlanView(COMPARE)} name={t('comparePlans')} meta={t('alternatives', { count: carePlans.length })} icon={<CompareIcon />} />
                    </>
                  )}
                  {carePlans.length === 0 && <div className="muted pad-y">{t('noAlternatives')}</div>}
                </div>
              </div>
            )}

            {costPlanError && mode === 'plan' && <p className="error pad">{costPlanError}</p>}

            {compare ? (
              <ComparePlans
                carePlans={carePlans}
                costPlanOf={costPlanOf}
                chargeItems={record.chargeItems}
                loading={!costPlans && !costPlanError}
                onJustify={justify}
                onOpen={setPlanView}
                onDelete={removePlan}
              />
            ) : (
              <>
                <div className="app-chart-head">
                  <div className="section-title">{selectedPlan ? selectedPlan.title ?? selectedPlan.id : t('chart')}</div>
                  <div className="muted" title={selectedPlan ? t('originalContent') : undefined}>{selectedPlan ? selectedPlan.description : t('chartHint', { date: chartDate ? date(chartDate) : '–' })}</div>
                </div>
                <div className="app-chart">
                  <OdontogramView status={status} plan={plan} mode={plan ? 'plan' : 'status'} />
                </div>
              </>
            )}
          </section>
        )}

        {record && selectedPlan && (
          <section className="app-card pad-card" aria-label={t('costPlan')}>
            <CostPlanDetail
              carePlan={selectedPlan}
              costPlan={costPlanOf.get(selectedPlan.id)}
              chargeItems={record.chargeItems}
              loading={!costPlans && !costPlanError}
              onJustify={justify}
              onDelete={removePlan}
            />
          </section>
        )}
      </main>
    </div>
  )
}

function PlanStepper({ index, count, onStep }: { index: number; count: number; onStep: (index: number) => void }) {
  return (
    <div className="stepper">
      <span className="muted">{t('planCount', { index: index + 1, count })}</span>
      <button type="button" className="icon-btn" aria-label={t('previousPlan')} onClick={() => onStep((index - 1 + count) % count)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
      </button>
      <button type="button" className="icon-btn" aria-label={t('nextPlan')} onClick={() => onStep((index + 1) % count)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
      </button>
    </div>
  )
}

function AddPlanMenu({ activePlan, onAdd }: { activePlan?: CarePlan; onAdd: (source?: CarePlan) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
  }, [open])

  const add = async (source?: CarePlan) => {
    setOpen(false)
    setBusy(true)
    setError(undefined)
    try { await onAdd(source) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="add-plan" ref={ref}>
      <button type="button" className="primary with-icon" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} disabled={busy}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        {busy ? t('adding') : t('addPlan')}
      </button>
      {open && (
        <div role="menu" className="menu">
          <button type="button" role="menuitem" onClick={() => add()}>
            <span className="menu-title">{t('blankPlan')}</span>
            <span className="muted">{t('blankPlanHint')}</span>
          </button>
          {activePlan && (
            <button type="button" role="menuitem" onClick={() => add(activePlan)}>
              <span className="menu-title">{t('duplicatePlan', { name: shortTitle(activePlan) })}</span>
              <span className="muted">{t('duplicateHint')}</span>
            </button>
          )}
        </div>
      )}
      {error && <div role="alert" className="error add-plan-error">{error}</div>}
    </div>
  )
}

// The cost plan Account of a CarePlan: the account of the planned ChargeItems that point to it.
function accountOf(carePlan: CarePlan, chargeItems: ChargeItem[]): string | undefined {
  const charge = chargeItems.find((c) => c.supportingInformation?.some((r) => r.reference === `CarePlan/${carePlan.id}`))
  return charge?.account?.[0]?.reference?.split('/')[1]
}

// "HKP Alternative A: Brücke 35–37 ..." -> "Alternative A"
function shortTitle(carePlan: CarePlan): string {
  const title = carePlan.title ?? carePlan.id
  return title.split(':')[0].replace(/^HKP\s+/, '')
}

function age(birthDate?: string): string {
  if (!birthDate) return '–'
  const d = new Date(birthDate)
  if (Number.isNaN(d.getTime())) return '–'
  const t = new Date()
  let years = t.getFullYear() - d.getFullYear()
  if (t.getMonth() < d.getMonth() || (t.getMonth() === d.getMonth() && t.getDate() < d.getDate())) years -= 1
  return String(years)
}

function PatientCard({ patient, mode, onMode }: { patient: Patient; mode: Mode; onMode: (mode: Mode) => void }) {
  const name = patient.name?.[0]
  const initials = `${name?.given?.[0]?.[0] ?? ''}${name?.family?.[0] ?? ''}`.toUpperCase() || '?'
  const gender = patient.gender === 'female' || patient.gender === 'male' || patient.gender === 'other' || patient.gender === 'unknown' ? t(patient.gender) : '–'
  return (
    <section className="app-card patient-card" aria-label={t('patientDemographics')}>
      <div className="patient-id">
        <div className="avatar" aria-hidden="true">{initials}</div>
        <div>
          <div className="eyebrow">{t('patient')}</div>
          <div className="patient-name">{patientName(patient)}</div>
        </div>
      </div>
      <Field label={t('gender')} value={gender} />
      <Field label={t('birthDate')} value={patient.birthDate ? date(patient.birthDate) : '–'} />
      <Field label={t('age')} value={t('years', { age: age(patient.birthDate) })} />
      <Field label={t('fhirId')} value={patient.id} mono />
      <DownloadButton label={t('downloadFhir')} title={t('downloadPatientTitle')} onDownload={() => downloadPatient(patient)} />
      <div className="field view-switch">
        <div className="field-label" id="view-label">{t('view')}</div>
        <div role="group" aria-labelledby="view-label" className="segmented">
          {(['status', 'plan'] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} className={mode === m ? 'on' : undefined} onClick={() => onMode(m)}>
              {m === 'status' ? t('status') : t('plan')}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      <div className={`field-value${mono ? ' mono' : ''}`}>{value}</div>
    </div>
  )
}

function Tab({ selected, onClick, name, meta, badge, icon }: { selected: boolean; onClick: () => void; name: string; meta: string; badge?: ReactNode; icon?: ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={selected} onClick={onClick} className={`tab${selected ? ' selected' : ''}`}>
      {icon}
      <span className="tab-text">
        <span className="tab-name">{name}{badge}</span>
        <span className="tab-meta">{meta}</span>
      </span>
    </button>
  )
}

// intent "plan" marks the alternative the patient chose; the others are options (dental-care-plan).
function PlanBadge({ carePlan }: { carePlan: CarePlan }) {
  return carePlan.intent === 'plan' ? <span className="badge ok">{t('chosen')}</span> : <span className="badge">{t('option')}</span>
}

function DecisionBadge({ decision }: { decision: string }) {
  const meta = DECISIONS[decision]
  return <span className={`badge ${meta?.tone ?? 'review'}`}>{meta ? t(meta.label) : decision}</span>
}

interface PlanProps {
  carePlan: CarePlan
  costPlan?: CostPlan
  chargeItems: ChargeItem[]
  loading: boolean
  onJustify: (chargeItemId: string, text: string) => Promise<void>
}

function ComparePlans({ carePlans, costPlanOf, chargeItems, loading, onJustify, onOpen, onDelete }: {
  carePlans: CarePlan[]; costPlanOf: Map<string, CostPlan>; chargeItems: ChargeItem[]; loading: boolean
  onJustify: PlanProps['onJustify']; onOpen: (id: string) => void; onDelete: (carePlan: CarePlan) => Promise<void>
}) {
  const totals = carePlans.map((p) => costPlanOf.get(p.id)?.total).filter((t): t is number => typeof t === 'number')
  const lowest = totals.length > 1 ? Math.min(...totals) : undefined
  const chosen = carePlans.find((p) => p.intent === 'plan')
  return (
    <div className="compare">
      <div className="compare-head">
        <div>
          <div className="section-title">{t('compareAlternatives')}</div>
          <div className="muted">{t('compareHint')}</div>
        </div>
        <div className={`banner${chosen ? ' ok' : ''}`}>
          {chosen ? t('chosenSummary', { name: shortTitle(chosen), total: euro(costPlanOf.get(chosen.id)?.total) }) : t('noChosen')}
        </div>
      </div>
      <div className="compare-grid">
        {carePlans.map((carePlan) => {
          const costPlan = costPlanOf.get(carePlan.id)
          return (
            <article key={carePlan.id} className={`plan-col${carePlan.intent === 'plan' ? ' chosen' : ''}`}>
              <div className="plan-col-head">
                <div className="plan-col-title">
                  <h3>{shortTitle(carePlan)}</h3>
                  <PlanBadge carePlan={carePlan} />
                </div>
                {costPlan && costPlan.total === lowest && <span className="app-pill">{t('lowestTotal')}</span>}
              </div>
              <div className="muted" title={t('originalContent')}>{carePlan.title?.split(':').slice(1).join(':').trim()}</div>
              <PlanBody carePlan={carePlan} costPlan={costPlan} chargeItems={chargeItems} loading={loading} onJustify={onJustify} compact />
              <div className="plan-col-actions">
                <button type="button" className="secondary" onClick={() => onOpen(carePlan.id)}>{t('showChart')}</button>
                <DownloadButton label="FHIR" title={t('downloadPlanTitle')} onDownload={() => downloadPlan(carePlan)} />
                <DeleteButton carePlan={carePlan} onDelete={onDelete} iconOnly />
              </div>
            </article>
          )
        })}
      </div>
      <p className="note">{t('demoDisclaimer')}</p>
    </div>
  )
}

function CostPlanDetail(props: PlanProps & { onDelete: (carePlan: CarePlan) => Promise<void> }) {
  return (
    <>
      <div className="detail-head">
        <h2>{t('costPlan')} <span className="muted-strong">· {shortTitle(props.carePlan)}</span></h2>
        <PlanBadge carePlan={props.carePlan} />
        <span className="detail-actions">
          <DownloadButton label={t('downloadFhir')} title={t('downloadPlanTitle')} onDownload={() => downloadPlan(props.carePlan)} />
          <DeleteButton carePlan={props.carePlan} onDelete={props.onDelete} />
        </span>
      </div>
      <PlanBody {...props} />
      <p className="note">{t('demoDisclaimer')}</p>
    </>
  )
}

function PlanBody({ costPlan, chargeItems, loading, onJustify, compact }: PlanProps & { compact?: boolean }) {
  if (!costPlan) return <div className="muted pad-y">{loading ? t('pricing') : t('noAccount')}</div>
  const lineOf = (id?: string) => costPlan.lines.find((l) => l.id === id)
  return (
    <>
      <div className="total-block">
        <div className="muted">{t('estimate')}</div>
        <div className="total">{euro(costPlan.total)}</div>
        <div className="muted">{t('gozServices', { count: costPlan.lines.length })}</div>
      </div>

      <div className={`decision ${DECISIONS[costPlan.decision]?.tone ?? 'review'}`}>
        <div className="decision-head">
          <span>{t('ruleCheck')}{costPlan.findings.length > 0 ? ` · ${t('findingCount', { count: costPlan.findings.length })}` : ''}</span>
          <DecisionBadge decision={costPlan.decision} />
        </div>
        {costPlan.findings.length === 0 && <div className="decision-ok">{t('noFindings')}</div>}
        {costPlan.findings.map((finding, i) => {
          const line = lineOf(finding.line)
          const explanation = findingExplanation(finding)
          return (
            <div key={`${finding.code}-${finding.line ?? i}`} className="finding">
              <span className="finding-kind">{explanation.kind}</span>
              <div className="finding-text">{findingText(finding, line)}</div>
              <p className="finding-explanation"><strong>{t('whyCheck')}</strong> {explanation.rule}</p>
              <p className="finding-explanation"><strong>{t('nextStep')}</strong> {explanation.action}</p>
              <details className="finding-details">
                <summary>{t('technicalDetails')}</summary>
                <div className="finding-code"><code>{finding.code}</code>{finding.rule && <> · {t('rule')} <code>{finding.rule}</code></>}</div>
                {finding.line && <div>{t('position')}: <a href={`/fhir/ChargeItem/${encodeURIComponent(finding.line)}`} target="_blank" rel="noreferrer">{finding.line}</a></div>}
                {finding.message && <div>{t('originalMessage')}: {finding.message}</div>}
                {finding.details?.fact && <div>{t('fhirFact')}: <code>{finding.details.fact}</code></div>}
                {finding.sources?.map((source, index) => (
                  <div key={`${source.uri}-${index}`}>
                    {source.uri?.startsWith('https://') ? <a href={source.uri} target="_blank" rel="noreferrer">{source.citation ?? source.uri}</a> : source.citation}
                  </div>
                ))}
              </details>
              {['MULTIPLIER_JUSTIFICATION_REQUIRED', 'GOZ_JUSTIFICATION_REQUIRED'].includes(finding.code) && finding.line && (
                <JustificationForm chargeItemId={finding.line} onSave={onJustify} />
              )}
            </div>
          )
        })}
      </div>

      <table className="lines">
        <thead>
          <tr>
            <th>GOZ</th>
            <th>{t('tooth')}</th>
            {!compact && <th className="num">{t('quantity')}</th>}
            <th className="num">{t('factor')}</th>
            <th className="num">{t('fee')}</th>
            {!compact && <th>{t('service')}</th>}
          </tr>
        </thead>
        <tbody>
          {costPlan.lines.map((line) => (
            <LineRow key={line.id} line={line} chargeItem={chargeItems.find((c) => c.id === line.id)} flagged={costPlan.findings.some((f) => f.line === line.id)} compact={compact} />
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={compact ? 3 : 4}>{t('total')}</td>
            <td className="num">{euro(costPlan.total)}</td>
            {!compact && <td />}
          </tr>
        </tfoot>
      </table>
    </>
  )
}

function LineRow({ line, chargeItem, flagged, compact }: { line: CostPlanLine; chargeItem?: ChargeItem; flagged: boolean; compact?: boolean }) {
  const reason = chargeItem?.reason?.map((r) => r.text ?? display(r)).filter(Boolean).join('; ')
  return (
    <tr className={flagged ? 'flagged' : undefined} title={compact ? `${t('originalContent')}: ${line.display}` : undefined}>
      <td><code>{line.code}</code>{compact && <div className="line-display">{line.display}</div>}</td>
      <td>{line.tooth || '–'}</td>
      {!compact && <td className="num">{line.quantity}</td>}
      <td className="num">{number(line.factor, { minimumFractionDigits: 1 })}{reason && <div className="reason" title={reason}>{t('justified')}</div>}</td>
      <td className="num">{euro(line.amount)}</td>
      {!compact && <td title={t('originalContent')}>{line.display}{reason && <div className="reason">{t('justification')}: {reason}</div>}</td>}
    </tr>
  )
}

function JustificationForm({ chargeItemId, onSave }: { chargeItemId: string; onSave: (id: string, text: string) => Promise<void> }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    setError(undefined)
    try { await onSave(chargeItemId, text) } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  return (
    <form className="justify" onSubmit={submit}>
      <label htmlFor={`justify-${chargeItemId}`}>{t('individualJustification')}</label>
      <textarea
        id={`justify-${chargeItemId}`}
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('justificationPlaceholder')}
      />
      <div className="justify-actions">
        <button type="submit" className="primary" disabled={busy || !text.trim()}>{busy ? t('saving') : t('saveRecheck')}</button>
        {error && <span className="error">{error}</span>}
      </div>
    </form>
  )
}

function DownloadButton({ label, title, onDownload }: { label: string; title: string; onDownload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const click = async () => {
    setBusy(true)
    setError(undefined)
    try { await onDownload() } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <span className="download">
      <button type="button" className="secondary with-icon" title={title} onClick={click} disabled={busy}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
        {busy ? t('preparing') : label}
      </button>
      {error && <span role="alert" className="error">{error}</span>}
    </span>
  )
}

// The chosen alternative (intent = plan) cannot be deleted; the button says why.
function DeleteButton({ carePlan, onDelete, iconOnly }: { carePlan: CarePlan; onDelete: (carePlan: CarePlan) => Promise<void>; iconOnly?: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const chosen = carePlan.intent === 'plan'
  const title = chosen ? t('chosenNoDelete') : t('deleteTitle')
  const click = async () => {
    setBusy(true)
    setError(undefined)
    try { await onDelete(carePlan) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <span className="download">
      <button type="button" className={`secondary danger${iconOnly ? ' icon-only' : ' with-icon'}`} title={title} aria-label={iconOnly ? title : undefined} onClick={click} disabled={busy || chosen}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
        {!iconOnly && (busy ? t('deleting') : t('deletePlan'))}
      </button>
      {error && <span role="alert" className="error">{error}</span>}
    </span>
  )
}

function ToothIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#2f6df6" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 3.5c-2.2 0-3.5 1.7-3.5 4 0 2 .8 3.2 1.4 5 .6 1.8.7 4.5 1.6 7 .4 1 1.4 1 1.8 0 .5-1.4.7-3.5 1.7-3.5s1.2 2.1 1.7 3.5c.4 1 1.4 1 1.8 0 .9-2.5 1-5.2 1.6-7 .6-1.8 1.4-3 1.4-5 0-2.3-1.3-4-3.5-4-1.2 0-1.9.6-3 .6S8.2 3.5 7 3.5z" />
    </svg>
  )
}

function CompareIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  )
}
