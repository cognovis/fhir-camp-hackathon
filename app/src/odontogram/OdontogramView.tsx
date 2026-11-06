import { useTranslation } from 'react-i18next'
import { language } from '../i18n.ts'
// INTEGRATION POINT: the chart component. See chartAdapter.ts for the contract.
//
// Renders the MIT odontogram (@cognovis/react-odontogram) and pushes a chart payload
// into it. The upstream engine is a module-level singleton driven by imperative functions, so
// only one chart can be mounted at a time.

import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react'
import { OdontogramShell, getSelectedTeeth, getStatusChart, importStatus, onStateChange, setChartMode, setImportAsBaseline, setPlanChart } from '@cognovis/react-odontogram'
import { PAYLOAD_VERSION, changedTeeth, type ChartPayload, type ChartTeeth } from './chartAdapter'

export interface OdontogramViewProps {
  status: ChartTeeth
  plan?: ChartTeeth
  mode: 'status' | 'plan'
  /** Called with the FDI number after a click selects exactly one tooth (the FHIR panel uses it). */
  onToothSelect?: (tooth: string) => void
  /**
   * Called with the teeth of the status chart whose tooth state the user changed (only changes a
   * tooth-state Observation can carry). A rejected promise marks them unsaved again, so the next
   * edit retries them. Each save round starts with a call with no teeth, so errors of earlier
   * rounds can be dropped. keepalive is set for saves started as the page unloads.
   */
  onStatusChange?: (changed: ChartTeeth, options?: { keepalive?: boolean }) => Promise<void>
}

// The upstream shell builds its tooth grid asynchronously after mount (it loads the tooth SVG
// templates first) and offers no ready callback. An import before the grid exists is not drawn,
// so wait until the grid has tooth graphics.
function whenGridReady(callback: () => void): () => void {
  let frame = 0
  let cancelled = false
  const check = () => {
    if (cancelled) return
    if (document.querySelector('#toothGrid svg')) callback()
    else frame = requestAnimationFrame(check)
  }
  check()
  return () => { cancelled = true; cancelAnimationFrame(frame) }
}

function statusTeeth(): ChartTeeth {
  return structuredClone((getStatusChart() as ChartPayload).teeth ?? {})
}

// One click in the chart can fire several state changes; write once the user pauses.
const SAVE_DELAY_MS = 600

export function OdontogramView({ status, plan, mode, onToothSelect, onStatusChange }: OdontogramViewProps) {
  useTranslation()
  // The status chart as last imported or handed to onStatusChange (saved or in flight); the
  // user's edits are the difference between it and the chart.
  const baseline = useRef<ChartTeeth>(undefined)
  // Teeth handed to onStatusChange whose save has not answered yet.
  const inFlight = useRef<ChartTeeth>({})
  // The last state known to be stored per tooth (imported, or saved successfully): a failed save
  // falls back to it.
  const persisted = useRef<ChartTeeth>({})
  const onStatusChangeRef = useRef(onStatusChange)
  onStatusChangeRef.current = onStatusChange

  useEffect(() => whenGridReady(() => {
    // The user's edits survive the import: those still waiting for the pause stay unsaved, so the
    // flush after the import reports them; those being saved stay as sent until the save answers.
    const pending = baseline.current ? changedTeeth(baseline.current, statusTeeth()) : {}
    const sent = inFlight.current
    // The chart only displays what FHIR holds. By default the library files every import as the
    // initial examination dated today; this view re-imports on every patient or plan change.
    setImportAsBaseline(false)
    // importStatus loads the status chart and switches the chart back to status mode.
    importStatus({ version: PAYLOAD_VERSION, teeth: { ...status, ...sent, ...pending } })
    if (plan && mode === 'plan') {
      // Hydrate the plan chart first, then switch to it: setChartMode repaints on the switch, so
      // the chart shows the selected alternative also when the previous one was a plan too.
      setPlanChart({ version: PAYLOAD_VERSION, teeth: plan })
      setChartMode('plan')
    } else {
      setChartMode('status')
    }
    const imported = statusTeeth()
    const kept = [...new Set([...Object.keys(sent), ...Object.keys(pending)])]
    persisted.current = { ...imported, ...Object.fromEntries(kept.map((tooth) => [tooth, status[tooth] ?? {}])) }
    baseline.current = { ...imported, ...sent, ...Object.fromEntries(Object.keys(pending).map((tooth) => [tooth, sent[tooth] ?? status[tooth] ?? {}])) }
  }), [status, plan, mode])

  // Editable: teeth can be clicked and changed. onStateChange fires on every edit, import and
  // settings change; only teeth whose tooth-state Observation would differ are reported.
  // The app owns the Status/Plan switch and the plan tabs; styles.css hides the chart's own.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const flush = (keepalive = false) => {
      clearTimeout(timer)
      const before = baseline.current
      const save = onStatusChangeRef.current
      if (!before || !save) return
      // A save round starts with no teeth: errors of earlier rounds are void, because every tooth
      // still unsaved is in `changed` again and retried (or the user undid it).
      save({}).catch(() => {})
      const changed = changedTeeth(before, statusTeeth())
      if (Object.keys(changed).length === 0) return
      baseline.current = { ...before, ...changed }
      inFlight.current = { ...inFlight.current, ...changed }
      // One save per tooth, so a failing tooth cannot mark a stored one unsaved.
      for (const [tooth, record] of Object.entries(changed)) {
        const settle = (failed: boolean) => {
          // A tooth edited again meanwhile has a newer record and is settled by its own save.
          if (inFlight.current[tooth] === record) {
            const { [tooth]: _settled, ...rest } = inFlight.current
            inFlight.current = rest
          }
          // When unsure what is stored, a tooth stays marked unsaved: a duplicate Observation is
          // better than a lost one.
          if (baseline.current?.[tooth] !== record) return
          if (failed) baseline.current = { ...baseline.current, [tooth]: persisted.current[tooth] ?? {} }
          else persisted.current = { ...persisted.current, [tooth]: record }
        }
        save({ [tooth]: record }, { keepalive }).then(() => settle(false), () => settle(true))
      }
    }
    const unsubscribe = onStateChange(() => {
      clearTimeout(timer)
      timer = setTimeout(() => flush(), SAVE_DELAY_MS)
    })
    // A page reload or close runs no React cleanup: start the saves now, as keepalive requests so
    // they outlive the page (within the browser's 64 KiB keepalive budget, a few dozen teeth). Saves
    // already in flight are the app's to resend (onStatusChange).
    const leave = () => flush(true)
    window.addEventListener('beforeunload', leave)
    // Leaving the chart (another patient) saves what is still waiting for the pause.
    return () => { window.removeEventListener('beforeunload', leave); unsubscribe(); flush() }
  }, [])

  // The upstream engine has no selection callback (onStateChange does not fire for a selection),
  // so read the selection after a click on a tooth, or Enter/Space in the tooth grid, has been
  // handled. Clicks on the toolbar or empty space are ignored.
  const reportSelection = () => {
    if (!onToothSelect) return
    requestAnimationFrame(() => {
      const selected = getSelectedTeeth()
      if (selected.length === 1) onToothSelect(String(selected[0]))
    })
  }
  const handleClick = (event: MouseEvent) => {
    if ((event.target as Element).closest('#toothGrid :is([data-tooth], .tooth-label-cell)')) reportSelection()
  }
  const handleKeyUp = (event: KeyboardEvent) => {
    if ((event.key === 'Enter' || event.key === ' ') && (event.target as Element).closest('#toothGrid')) reportSelection()
  }

  return (
    <div onClick={handleClick} onKeyUp={handleKeyUp}>
      <OdontogramShell language={language()} numberingSystem="FDI" />
    </div>
  )
}
