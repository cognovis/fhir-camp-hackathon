import { ChartNoAxesColumn, ChevronDown, Flame, Trash2 } from 'lucide-react'
import { AlertDialog, Avatar, Badge, Button, Callout, Card, DropdownMenu, Flex, Link, Select, Skeleton, Spinner, Table, Tabs, TextArea, Tooltip } from '@radix-ui/themes'
import { useTranslation } from 'react-i18next'
import { t, date, number } from './i18n.ts'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { DECISIONS, euro, findingExplanation, findingText, loadCostPlans, saveJustification, type CostPlan, type CostPlanLine } from './costPlan'
import { display, loadPatientRecord, patientName, search, toothOf, type CarePlan, type ChargeItem, type Patient, type PatientRecord, type Resource } from './fhir'
import { FhirPanel } from './inspector/FhirPanel'
import { toChartStatus, toPlanChart } from './odontogram/chartAdapter'
import { captureChart, OdontogramView } from './odontogram/OdontogramView'
import { createPlan, deletePlan } from './plans'

const DENTAL_PATIENT = 'https://github.com/cognovis/fhir-camp-hackathon/sid/patient'

// Status: the current chart only. Plan: the alternatives, each on the chart, or all side by side.
type Mode = 'status' | 'plan'
const COMPARE = 'compare'

const ToothIcon = ({ size, color = 'currentColor' }: { readonly size: number; readonly color?: string }) => (
  <svg className="tooth-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 3c-3 0-4.5 2-4.5 4.5 0 2 .9 3.5 1.5 5.5s.8 5.5 2 7c.7.9 1.5.5 1.8-.5.5-1.5.7-5 3.2-5s2.7 3.5 3.2 5c.3 1 1.1 1.4 1.8.5 1.2-1.5 1.4-5 2-7s1.5-3.5 1.5-5.5C20.5 5 19 3 16 3c-1.5 0-2.5 1-4 1s-2.5-1-4-1Z" />
  </svg>
)

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
  // The FHIR panel: what the app reads and writes, live from Aidbox.
  const appElement = useRef<HTMLDivElement>(null)
  const previewPanelWidth = useCallback((width: number) => {
    appElement.current?.style.setProperty('--fhir-panel-width', `${width}px`)
  }, [])
  const [chartSuspended, setChartSuspended] = useState(false)
  const suspendedChart = useRef<{ state: ReturnType<typeof captureChart>; record: typeof record; planView: typeof planView; mode: Mode; height: number } | undefined>(undefined)
  const markPanelResizing = useCallback((active: boolean) => {
    if (active) {
      const chart = appElement.current?.querySelector('.app-chart')
      if (chart?.querySelector('#toothGrid svg')) suspendedChart.current = { state: captureChart(), record, planView, mode, height: chart.clientHeight }
    }
    appElement.current?.setAttribute('data-resizing', String(active))
    setChartSuspended(active)
  }, [record, planView, mode])
  const [panelWidth, setPanelWidth] = useState(640)
  const [panelOpen, setPanelOpen] = useState(false)
  const [inspected, setInspected] = useState<Resource>()
  const [inspection, setInspection] = useState(0)
  const inspect = useCallback((resource: Resource) => {
    setInspected(resource)
    setInspection((n) => n + 1)
    setPanelOpen(true)
  }, [])
  // Follow the app (plan tabs, chart, writes) only while the panel is open.
  const panelOpenRef = useRef(panelOpen)
  panelOpenRef.current = panelOpen
  const follow = useCallback((resource: Resource | undefined) => { if (resource && panelOpenRef.current) inspect(resource) }, [inspect])

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
    setInspected(undefined)
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
    follow(saved)
    await recheck()
  }, [recheck, follow])

  // Write a new alternative (blank, or a copy of `source` with its cost plan), then reload and show it.
  const addPlan = useCallback(async (source?: CarePlan) => {
    if (!record) return
    const created = await createPlan(record.patient, record.carePlans, record.chargeItems, source)
    setRecord(await loadPatientRecord(record.patient))
    setPlanView(created.id)
    follow(created)
    await recheck()
  }, [record, recheck, follow])

  // Delete an alternative with its cost plan, then show the chosen one again.
  const removePlan = useCallback(async (carePlan: CarePlan) => {
    if (!record) return
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

  const inspectTooth = useCallback((tooth: string) => {
    follow(record?.toothStates.find((observation) => toothOf(observation.bodySite) === tooth))
  }, [record, follow])

  const patient = record?.patient
  const activeView = compare ? COMPARE : selectedPlan?.id ?? 'status'
  const selectPlanView = (value: string) => {
    setPlanView(value)
    follow(carePlans.find((p) => p.id === value))
  }
  const chartDate = record?.toothStates[0]?.effectiveDateTime ?? ''

  return (
    <div ref={appElement} className={panelOpen ? 'app-page with-fhir-panel' : 'app-page'} style={{ '--fhir-panel-width': `${panelWidth}px` } as CSSProperties}>
      <div className="appbar">
        <ToothIcon size={34} color="var(--accent-9)" />
        <div>
          <div className="appbar-title">{t('appTitle')}</div>
          <div className="appbar-sub">{t('appSubtitle')}</div>
        </div>
        <div className="patient-select">
          <span id="patient-label">{t('patient')}</span>
          <Select.Root value={patientId} onValueChange={setPatientId}>
            <Select.Trigger aria-labelledby="patient-label" />
            <Select.Content>
              {patients.map((p) => <Select.Item key={p.id} value={p.id}>{patientName(p)} ({p.id})</Select.Item>)}
            </Select.Content>
          </Select.Root>
        </div>
        <Button type="button" variant="outline" className="fhir-toggle" aria-pressed={panelOpen} title={t('panelToggle')} onClick={() => setPanelOpen((open) => !open)}>
          <Flame size={16} aria-hidden="true" /> FHIR
        </Button>
      </div>

      <FhirPanel open={panelOpen} onOpenChange={setPanelOpen} resource={inspected} inspection={inspection} patient={patient} carePlans={carePlans} width={panelWidth} onWidthChange={setPanelWidth} onResizingChange={markPanelResizing} onWidthPreview={previewPanelWidth} />

      <main className="content">
        {error && <p className="error">{error}</p>}
        {!record && !error && <div className="loading-state"><Spinner className="app-spinner" role="status" aria-label={t('loading')} />{t('loading')}</div>}

        {patient && <PatientCard patient={patient} onInspect={inspect} />}

        <Tabs.Root value={mode} onValueChange={(value) => setMode(value as Mode)} className="mode-tabs">
          <Tabs.List aria-label={t('view')}>
            <Tabs.Trigger value="status">{t('status')}</Tabs.Trigger>
            <Tabs.Trigger value="plan">{t('plan')}</Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value={mode} className="mode-content">
        {record && status && (
          <Card className="app-card plans-card" asChild>
            <Tabs.Root value={activeView} onValueChange={selectPlanView} aria-label={mode === 'plan' ? t('plansAndChart') : t('chart')}>
              {mode === 'plan' && (
                <div className="plan-nav">
                  <div className="plan-nav-head">
                    <div>
                      <div className="section-title">{t('plans')}</div>
                      <div className="muted">{t('plansIntro', { name: patient?.name?.[0]?.given?.[0] ?? patientName(record.patient) })}</div>
                    </div>
                    <div className="plan-nav-actions">
                      <Button type="button" variant="outline" onClick={recheck} disabled={checking} aria-busy={checking}>{checking && <Spinner className="app-spinner" role="status" aria-label={t('checking')} />}{checking ? t('checking') : t('recheck')}</Button>
                      <AddPlanMenu activePlan={selectedPlan} onAdd={addPlan} />
                    </div>
                  </div>
                  <Tabs.List aria-label={t('plans')} className="tabs">
                    {carePlans.map((carePlan) => {
                      const costPlan = costPlanOf.get(carePlan.id)
                      return (
                        <Tab
                          key={carePlan.id}
                          value={carePlan.id}
                          name={shortTitle(carePlan)}
                          badge={<PlanBadge carePlan={carePlan} />}
                          meta={costPlan ? `${t('services', { count: costPlan.lines.length })} · ${euro(costPlan.total)}` : t('activities', { count: carePlan.activity?.length ?? 0 })}
                        />
                      )
                    })}
                    {carePlans.length > 0 && (
                      <>
                        <div className="tab-sep" aria-hidden="true" />
                        <Tab value={COMPARE} name={t('comparePlans')} meta={t('alternatives', { count: carePlans.length })} icon={<ChartNoAxesColumn size={18} aria-hidden="true" />} />
                      </>
                    )}
                    {carePlans.length === 0 && <div className="muted pad-y">{t('noAlternatives')}</div>}
                  </Tabs.List>
                </div>
              )}

              <Tabs.Content value={activeView} {...(mode === 'status' ? { role: 'region', 'aria-labelledby': 'chart-heading' } : {})}>
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
                    onInspect={inspect}
                  />
                ) : (
                  <>
                    <div className="app-chart-head">
                      <div id="chart-heading" className="section-title">{selectedPlan ? selectedPlan.title ?? selectedPlan.id : t('chart')}</div>
                      <div className="muted" title={selectedPlan ? t('originalContent') : undefined}>{selectedPlan ? selectedPlan.description : t('chartHint', { date: chartDate ? date(chartDate) : '–' })}</div>
                    </div>
                    <div className="app-chart" style={chartSuspended ? { height: suspendedChart.current?.height, boxSizing: 'border-box' } : undefined}>
                      {chartSuspended ? <div className="chart-resize-placeholder" role="status" aria-label={t('loading')}><Skeleton width="100%" height="100%" /></div> : <OdontogramView
                        resume={suspendedChart.current?.record === record && suspendedChart.current?.planView === planView && suspendedChart.current?.mode === mode ? suspendedChart.current.state : undefined}
                        status={status}
                        plan={plan}
                        mode={plan ? 'plan' : 'status'}
                        onToothSelect={inspectTooth}
                      />}
                    </div>
                  </>
                )}
              </Tabs.Content>
            </Tabs.Root>
          </Card>
        )}

        {record && selectedPlan && (
          <Card asChild className="app-card pad-card"><section aria-label={t('costPlan')}>
            <CostPlanDetail
              carePlan={selectedPlan}
              costPlan={costPlanOf.get(selectedPlan.id)}
              chargeItems={record.chargeItems}
              loading={!costPlans && !costPlanError}
              onJustify={justify}
              onDelete={removePlan}
              onInspect={inspect}
            />
          </section></Card>
        )}
          </Tabs.Content>
        </Tabs.Root>
      </main>
    </div>
  )
}

function AddPlanMenu({ activePlan, onAdd }: { activePlan?: CarePlan; onAdd: (source?: CarePlan) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const add = async (source?: CarePlan) => {
    setBusy(true)
    setError(undefined)
    try { await onAdd(source) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="add-plan">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          <Button disabled={busy} aria-busy={busy}>
            {busy && <Spinner role="status" aria-label={t('adding')} />}
            {busy ? t('adding') : t('addPlan')}<ChevronDown size={16} aria-hidden="true" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content>
          <DropdownMenu.Item className="plan-menu-item" onSelect={() => void add()}><span>{t('blankPlan')}<small>{t('blankPlanHint')}</small></span></DropdownMenu.Item>
          {activePlan && <DropdownMenu.Item className="plan-menu-item" onSelect={() => void add(activePlan)}><span>{t('duplicatePlan', { name: shortTitle(activePlan) })}<small>{t('duplicateHint')}</small></span></DropdownMenu.Item>}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
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

function PatientCard({ patient, onInspect }: { patient: Patient; onInspect: (resource: Resource) => void }) {
  const name = patient.name?.[0]
  const initials = `${name?.given?.[0]?.[0] ?? ''}${name?.family?.[0] ?? ''}`.toUpperCase() || '?'
  const gender = patient.gender === 'female' || patient.gender === 'male' || patient.gender === 'other' || patient.gender === 'unknown' ? t(patient.gender) : '–'
  return (
    <Card asChild className="app-card patient-card"><section aria-label={t('patientDemographics')}>
      <div className="patient-id">
        <Avatar size="4" radius="full" fallback={initials} aria-hidden="true" />
        <div>
          <div className="eyebrow">{t('patient')}</div>
          <div className="patient-name">{patientName(patient)}</div>
        </div>
      </div>
      <Field label={t('gender')} value={gender} />
      <Field label={t('birthDate')} value={patient.birthDate ? date(patient.birthDate) : '–'} />
      <Field label={t('age')} value={t('years', { age: age(patient.birthDate) })} />
      <Field label={t('fhirId')} value={patient.id} mono />
      <span className="patient-actions">
        <InspectButton resource={patient} onInspect={onInspect} />
      </span>

    </section></Card>
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

function Tab({ value, name, meta, badge, icon }: { value: string; name: string; meta: string; badge?: ReactNode; icon?: ReactNode }) {
  return (
    <Tabs.Trigger value={value} className="plan-tab" title={meta}>
      <Flex align="center" gap="2">
        {icon}<span className="tab-name">{name}{badge}</span>
      </Flex>
    </Tabs.Trigger>
  )
}

// intent "plan" marks the alternative the patient chose; the others are options (dental-care-plan).
function PlanBadge({ carePlan }: { carePlan: CarePlan }) {
  return carePlan.intent === 'plan' ? <Badge color="green">{t('chosen')}</Badge> : <Badge color="gray">{t('option')}</Badge>
}

function DecisionBadge({ decision }: { decision: string }) {
  const meta = DECISIONS[decision]
  return <Badge color={meta?.tone === 'ok' ? 'green' : meta?.tone === 'bad' ? 'red' : 'amber'}>{meta ? t(meta.label) : decision}</Badge>
}

interface PlanProps {
  carePlan: CarePlan
  costPlan?: CostPlan
  chargeItems: ChargeItem[]
  loading: boolean
  onJustify: (chargeItemId: string, text: string) => Promise<void>
  onInspect: (resource: Resource) => void
}

function ComparePlans({ carePlans, costPlanOf, chargeItems, loading, onJustify, onOpen, onDelete, onInspect }: {
  carePlans: CarePlan[]; costPlanOf: Map<string, CostPlan>; chargeItems: ChargeItem[]; loading: boolean
  onJustify: PlanProps['onJustify']; onOpen: (id: string) => void; onDelete: (carePlan: CarePlan) => Promise<void>
  onInspect: PlanProps['onInspect']
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
        <Callout.Root size="1" color={chosen ? 'green' : 'gray'}>
          <Callout.Text>{chosen ? t('chosenSummary', { name: shortTitle(chosen), total: euro(costPlanOf.get(chosen.id)?.total) }) : t('noChosen')}</Callout.Text>
        </Callout.Root>
      </div>
      <div className="compare-grid">
        {carePlans.map((carePlan) => {
          const costPlan = costPlanOf.get(carePlan.id)
          return (
            <Card asChild key={carePlan.id} className={`plan-col${carePlan.intent === 'plan' ? ' chosen' : ''}`}><article>
              <div className="plan-col-head">
                <div className="plan-col-title">
                  <h3>{shortTitle(carePlan)}</h3>
                  <PlanBadge carePlan={carePlan} />
                </div>
                <div className="card-actions">
                  <Tooltip content={t('showChart')}><button type="button" className="card-action" aria-label={t('showChart')} onClick={() => onOpen(carePlan.id)}><ToothIcon size={16} /></button></Tooltip>
                  <InspectButton resource={carePlan} onInspect={onInspect} />
                  <DeleteButton carePlan={carePlan} onDelete={onDelete} iconOnly />
                </div>
              </div>
              {costPlan && costPlan.total === lowest && <Badge style={{ alignSelf: 'flex-start' }}>{t('lowestTotal')}</Badge>}
              <div className="muted" title={t('originalContent')}>{carePlan.title?.split(':').slice(1).join(':').trim()}</div>
              <PlanBody carePlan={carePlan} costPlan={costPlan} chargeItems={chargeItems} loading={loading} onJustify={onJustify} onInspect={onInspect} compact />
            </article></Card>
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
          <InspectButton resource={props.carePlan} onInspect={props.onInspect} />
          <DeleteButton carePlan={props.carePlan} onDelete={props.onDelete} iconOnly />
        </span>
      </div>
      <PlanBody {...props} />
      <p className="note">{t('demoDisclaimer')}</p>
    </>
  )
}

function PlanBody({ costPlan, chargeItems, loading, onJustify, onInspect, compact }: PlanProps & { compact?: boolean }) {
  if (!costPlan) return <div className="muted pad-y loading-state">{loading && <Spinner className="app-spinner" role="status" aria-label={t('pricing')} />}{loading ? t('pricing') : t('noAccount')}</div>
  const lineOf = (id?: string) => costPlan.lines.find((l) => l.id === id)
  return (
    <>
      <div className="total-block">
        <div className="muted">{t('estimate')}</div>
        <div className="total">{euro(costPlan.total)}</div>
        <div className="muted">{t('gozServices', { count: costPlan.lines.length })}</div>
      </div>

      <Callout.Root className="decision" color={DECISIONS[costPlan.decision]?.tone === 'ok' ? 'green' : DECISIONS[costPlan.decision]?.tone === 'bad' ? 'red' : 'amber'}><div className="decision-body">
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
      </div></Callout.Root>

      <Table.Root className="lines">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeaderCell>GOZ</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>{t('tooth')}</Table.ColumnHeaderCell>
            {!compact && <Table.ColumnHeaderCell className="num">{t('quantity')}</Table.ColumnHeaderCell>}
            <Table.ColumnHeaderCell className="num">{t('factor')}</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell className="num">{t('fee')}</Table.ColumnHeaderCell>
            {!compact && <Table.ColumnHeaderCell>{t('service')}</Table.ColumnHeaderCell>}
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {costPlan.lines.map((line) => (
            <LineRow key={line.id} line={line} chargeItem={chargeItems.find((c) => c.id === line.id)} flagged={costPlan.findings.some((f) => f.line === line.id)} compact={compact} onInspect={onInspect} />
          ))}
        </Table.Body>
        <tfoot>
          <Table.Row>
            <Table.Cell colSpan={compact ? 3 : 4}>{t('total')}</Table.Cell>
            <Table.Cell className="num">{euro(costPlan.total)}</Table.Cell>
            {!compact && <Table.Cell />}
          </Table.Row>
        </tfoot>
      </Table.Root>
    </>
  )
}

function LineRow({ line, chargeItem, flagged, compact, onInspect }: { line: CostPlanLine; chargeItem?: ChargeItem; flagged: boolean; compact?: boolean; onInspect: (resource: Resource) => void }) {
  const reason = chargeItem?.reason?.map((r) => r.text ?? display(r)).filter(Boolean).join('; ')
  return (
    <Table.Row className={flagged ? 'flagged' : undefined} title={compact ? `${t('originalContent')}: ${line.display}` : undefined}>
      <Table.Cell>
        {/* The GOZ number opens the planned ChargeItem in the FHIR panel. */}
        {chargeItem
          ? <Link asChild><button type="button" className="code-link" title={t('inspectResource', { resource: `ChargeItem/${chargeItem.id}` })} onClick={() => onInspect(chargeItem)}><code>{line.code}</code></button></Link>
          : <code>{line.code}</code>}
        {compact && <div className="line-display">{line.display}</div>}
      </Table.Cell>
      <Table.Cell>{line.tooth || '–'}</Table.Cell>
      {!compact && <Table.Cell className="num">{line.quantity}</Table.Cell>}
      <Table.Cell className="num">{number(line.factor, { minimumFractionDigits: 1 })}{reason && <div className="reason" title={reason}>{t('justified')}</div>}</Table.Cell>
      <Table.Cell className="num">{euro(line.amount)}</Table.Cell>
      {!compact && <Table.Cell title={t('originalContent')}>{line.display}{reason && <div className="reason">{t('justification')}: {reason}</div>}</Table.Cell>}
    </Table.Row>
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
      <TextArea
        id={`justify-${chargeItemId}`}
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('justificationPlaceholder')}
      />
      <div className="justify-actions">
        <Button type="submit" variant="solid" disabled={busy || !text.trim()} aria-busy={busy}>{busy && <Spinner className="app-spinner" role="status" aria-label={t('saving')} />}{busy ? t('saving') : t('saveRecheck')}</Button>
        {error && <span className="error">{error}</span>}
      </div>
    </form>
  )
}

// Opens a resource in the FHIR panel.
function InspectButton({ resource, onInspect }: { resource: Resource; onInspect: (resource: Resource) => void }) {
  const label = t('inspectResource', { resource: `${resource.resourceType}/${resource.id}` })
  return (
    <Tooltip content={label}>
      <button type="button" className="card-action" aria-label={label} onClick={() => onInspect(resource)}>
        <Flame size={16} aria-hidden="true" />
      </button>
    </Tooltip>
  )
}

// The chosen alternative (intent = plan) cannot be deleted; the button says why.
function DeleteButton({ carePlan, onDelete, iconOnly }: { carePlan: CarePlan; onDelete: (carePlan: CarePlan) => Promise<void>; iconOnly?: boolean }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const chosen = carePlan.intent === 'plan'
  const title = chosen ? t('chosenNoDelete') : t('deleteTitle')
  const remove = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await onDelete(carePlan)
      setOpen(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const icon = <Trash2 size={16} aria-hidden="true" />
  return (
    <AlertDialog.Root open={open} onOpenChange={(value) => { if (!busy) setOpen(value) }}>
      <AlertDialog.Trigger>
        {iconOnly
          ? <button type="button" className="card-action card-action-danger" title={title} aria-label={title} disabled={chosen}>{icon}</button>
          : <Button color="red" variant="outline" title={title} disabled={chosen}>{icon}{t('deletePlan')}</Button>}
      </AlertDialog.Trigger>
      <AlertDialog.Content maxWidth="440px">
        <AlertDialog.Title>{t('deletePlan')}</AlertDialog.Title>
        <AlertDialog.Description>{t('confirmDelete', { name: carePlan.title ?? carePlan.id })}</AlertDialog.Description>
        {error && <p role="alert" className="error">{error}</p>}
        <Flex justify="end" gap="3" mt="4">
          <AlertDialog.Cancel><Button color="gray" variant="soft" disabled={busy}>{t('cancel')}</Button></AlertDialog.Cancel>
          <Button color="red" onClick={() => void remove()} disabled={busy} aria-busy={busy}>
            {busy && <Spinner role="status" aria-label={t('deleting')} />}{busy ? t('deleting') : t('deletePlan')}
          </Button>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  )
}
