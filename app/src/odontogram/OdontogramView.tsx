// INTEGRATION POINT: the chart component. See chartAdapter.ts for the contract.
//
// Renders the MIT odontogram (@cognovis/react-odontogram) and pushes a chart payload
// into it. The upstream engine is a module-level singleton driven by imperative functions, so
// only one chart can be mounted at a time.

import { useEffect, type KeyboardEvent, type MouseEvent } from 'react'
import { OdontogramShell, getSelectedTeeth, importStatus, setChartMode, setImportAsBaseline, setPlanChart } from '@cognovis/react-odontogram'
import { PAYLOAD_VERSION, type ChartTeeth } from './chartAdapter'

export interface OdontogramViewProps {
  status: ChartTeeth
  plan?: ChartTeeth
  mode: 'status' | 'plan'
  /** Called with the FDI number after a click selects exactly one tooth (the FHIR panel uses it). */
  onToothSelect?: (tooth: string) => void
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

export function OdontogramView({ status, plan, mode, onToothSelect }: OdontogramViewProps) {
  useEffect(() => whenGridReady(() => {
    // The chart only displays what FHIR holds. By default the library files every import as the
    // initial examination dated today; this view re-imports on every patient or plan change.
    setImportAsBaseline(false)
    // importStatus loads the status chart and switches the chart back to status mode.
    importStatus({ version: PAYLOAD_VERSION, teeth: status })
    if (plan && mode === 'plan') {
      // Hydrate the plan chart first, then switch to it: setChartMode repaints on the switch, so
      // the chart shows the selected alternative also when the previous one was a plan too.
      setPlanChart({ version: PAYLOAD_VERSION, teeth: plan })
      setChartMode('plan')
    } else {
      setChartMode('status')
    }
  }), [status, plan, mode])

  // Editable: teeth can be clicked and changed. Changes stay in the browser until they are
  // written back as FHIR Observations (TASKS.md, task 1: subscribe with onStateChange and read
  // the chart with getStatusChart). Selecting another patient or plan reloads the chart from FHIR.
  // The app owns the Status/Plan switch and the plan tabs; styles.css hides the chart's own.
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
    if ((event.target as Element).closest('#toothGrid [data-tooth]')) reportSelection()
  }
  const handleKeyUp = (event: KeyboardEvent) => {
    if ((event.key === 'Enter' || event.key === ' ') && (event.target as Element).closest('#toothGrid')) reportSelection()
  }

  return (
    <div onClick={handleClick} onKeyUp={handleKeyUp}>
      <OdontogramShell language="de" numberingSystem="FDI" />
    </div>
  )
}
