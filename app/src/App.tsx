import { useEffect, useMemo, useState } from 'react'
import { display, loadPatientRecord, patientName, search, toothOf, type CarePlan, type Patient, type PatientRecord } from './fhir'
import { toChartStatus, toPlanChart } from './odontogram/chartAdapter'
import { OdontogramView } from './odontogram/OdontogramView'

const DENTAL_PATIENT = 'https://github.com/cognovis/fhir-camp-hackathon/sid/patient'

export function App() {
  const [patients, setPatients] = useState<Patient[]>([])
  const [patientId, setPatientId] = useState<string>()
  const [record, setRecord] = useState<PatientRecord>()
  const [planId, setPlanId] = useState<string>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    search<Patient>(`Patient?identifier=${encodeURIComponent(`${DENTAL_PATIENT}|`)}&_sort=_id&_count=50`)
      .then((list) => { setPatients(list); setPatientId((current) => current ?? list.find((p) => p.id === 'dent-051')?.id ?? list[0]?.id) })
      .catch((e: Error) => setError(`${e.message}. Is Aidbox running and loaded (npm run setup)?`))
  }, [])

  useEffect(() => {
    const patient = patients.find((p) => p.id === patientId)
    if (!patient) return
    setRecord(undefined)
    setPlanId(undefined)
    // Ignore the answer of a load that a newer patient selection has superseded.
    let current = true
    loadPatientRecord(patient)
      .then((loaded) => { if (current) setRecord(loaded) })
      .catch((e: Error) => { if (current) setError(e.message) })
    return () => { current = false }
  }, [patients, patientId])

  const status = useMemo(() => (record ? toChartStatus(record.toothStates) : undefined), [record])
  const selectedPlan = record?.carePlans.find((p) => p.id === planId)
  const plan = useMemo(
    () => (record && status && selectedPlan ? toPlanChart(status, selectedPlan, record.toothStates) : undefined),
    [record, status, selectedPlan],
  )

  return (
    <div className="app-layout">
      <header>
        <h1>FHIR Camp starter app</h1>
        <label>
          Patient{' '}
          <select value={patientId ?? ''} onChange={(e) => setPatientId(e.target.value)}>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>{patientName(p)} ({p.birthDate}, {p.id})</option>
            ))}
          </select>
        </label>
        <span className="note">Synthetic data. Chart: react-advanced-odontogram (MIT). Chart changes are not saved yet (task 1).</span>
      </header>

      {error && <p className="error">{error}</p>}

      {record && status && (
        <>
          <section className="app-chart">
            <h2>{selectedPlan ? `Planned: ${selectedPlan.title ?? selectedPlan.id}` : `Status ${record.toothStates[0]?.effectiveDateTime ?? ''}`}</h2>
            <OdontogramView status={status} plan={plan} mode={plan ? 'plan' : 'status'} />
          </section>

          <section className="side">
            <div>
            <h2>Findings</h2>
            <ul>
              {record.conditions.map((c) => (
                <li key={c.id}>{display(c.code)}{c.bodySite?.[0] ? ` (tooth ${toothOf(c.bodySite[0]) ?? display(c.bodySite[0])})` : ''}</li>
              ))}
              {record.findings.map((o) => (
                <li key={o.id}>{display(o.code)}{o.bodySite ? ` (tooth ${toothOf(o.bodySite) ?? display(o.bodySite)})` : ''}{o.valueCodeableConcept ? `: ${display(o.valueCodeableConcept)}` : ''}</li>
              ))}
              {record.conditions.length + record.findings.length === 0 && <li>None recorded.</li>}
            </ul>
            </div>
            <div>
            <h2>Treatment alternatives</h2>
            <label className="plan">
              <input type="radio" name="plan" checked={!planId} onChange={() => setPlanId(undefined)} /> Status (no plan)
            </label>
            <div className="plans">
              {record.carePlans.map((carePlan) => (
                <PlanCard key={carePlan.id} carePlan={carePlan} record={record} selected={carePlan.id === planId} onSelect={() => setPlanId(carePlan.id)} />
              ))}
            </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function PlanCard({ carePlan, record, selected, onSelect }: { carePlan: CarePlan; record: PatientRecord; selected: boolean; onSelect: () => void }) {
  const charges = record.chargeItems.filter((c) => c.supportingInformation?.some((r) => r.reference === `CarePlan/${carePlan.id}`))
  return (
    <div className={`plan-card${selected ? ' selected' : ''}`}>
      <label className="plan">
        <input type="radio" name="plan" checked={selected} onChange={onSelect} />{' '}
        <strong>{carePlan.title ?? carePlan.id}</strong>
      </label>
      <div className="meta">
        intent <code>{carePlan.intent}</code>, status <code>{carePlan.status}</code>, {carePlan.activity?.length ?? 0} activities
        {charges.length > 0 && <>, {charges.length} planned ChargeItems</>}
      </div>
      {selected && charges.length > 0 && (
        <table>
          <thead><tr><th>GOZ</th><th>Tooth</th><th>Qty</th><th>Factor</th><th>Service</th></tr></thead>
          <tbody>
            {charges.map((c) => (
              <tr key={c.id}>
                <td>{c.code.coding?.[0]?.code}</td>
                <td>{toothOf(c.bodysite?.[0]) ?? ''}</td>
                <td>{c.quantity?.value ?? 1}</td>
                <td>{c.factorOverride ?? ''}</td>
                <td>{display(c.code)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {selected && charges.length > 0 && <p className="note">Prices: <code>npm run cost-plan</code> (see TASKS.md, "Cost plan view").</p>}
    </div>
  )
}
