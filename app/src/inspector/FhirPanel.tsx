import { Download } from 'lucide-react'
import { Badge, Button, Spinner, Tabs, Theme } from '@radix-ui/themes'
import { useTranslation } from 'react-i18next'
import { t } from '../i18n.ts'
// The FHIR panel uses Radix Themes for app controls and Health Samurai for the
// non-modal sheet and specialized FHIR viewers:
// - "Resource": the resource you clicked in the app as FHIR JSON, its profiles, a $validate
//   button with the OperationOutcome, and a link to the same resource in the Aidbox UI.
// - "Profile": the profile the resource claims, as the element tree the Aidbox UI shows.
// - "Requests": every FHIR request the app sent (fhirRequest in fhir.ts) with its response.

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  CodeEditor,
  OperationOutcomeView,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@health-samurai/react-components'
import { clearFhirLog, subscribeFhirLog, validateResource, type FhirLogEntry, type OperationOutcome, type Resource } from '../fhir'
import { ProfileView } from './ProfileView'
import { downloadPatient, downloadPlan } from '../download'
import { patientName, type Patient, type CarePlan } from '../fhir'

declare const __AIDBOX_BROWSER_URL__: string

export function aidboxUiUrl(resource: Resource): string {
  return `${__AIDBOX_BROWSER_URL__}/u/resource/${resource.resourceType}/edit/${encodeURIComponent(resource.id)}`
}

export interface FhirPanelProps {
  width: number
  onWidthChange: (width: number) => void
  onWidthPreview: (width: number) => void
  onResizingChange: (active: boolean) => void
  patient?: Patient
  carePlans: CarePlan[]
  open: boolean
  onOpenChange: (open: boolean) => void
  resource?: Resource
  /** Increases with every inspection, also of the same resource again. */
  inspection: number
}

export function FhirPanel({ open, onOpenChange, resource, inspection, patient, carePlans, width, onWidthChange, onResizingChange, onWidthPreview }: FhirPanelProps) {
  useTranslation()
  const [tab, setTab] = useState('resource')
  const panelElement = useRef<HTMLDivElement>(null)
  const resizeFrame = useRef<number | undefined>(undefined)
  const pendingWidth = useRef(width)
  const dragging = useRef(false)
  const activePointer = useRef<number | undefined>(undefined)
  useEffect(() => () => {
    if (resizeFrame.current !== undefined) cancelAnimationFrame(resizeFrame.current)
    onResizingChange(false)
  }, [onResizingChange])
  const resize = (next: number) => {
    pendingWidth.current = next
    if (resizeFrame.current !== undefined) return
    resizeFrame.current = requestAnimationFrame(() => {
      resizeFrame.current = undefined
      panelElement.current?.style.setProperty('--fhir-panel-width', `${pendingWidth.current}px`)
      onWidthPreview(pendingWidth.current)
    })
  }
  const finishResize = () => {
    dragging.current = false
    activePointer.current = undefined
    panelElement.current?.setAttribute('data-resizing', 'false')
    onResizingChange(false)
    if (resizeFrame.current !== undefined) cancelAnimationFrame(resizeFrame.current)
    resizeFrame.current = undefined
    panelElement.current?.style.setProperty('--fhir-panel-width', `${pendingWidth.current}px`)
    onWidthPreview(pendingWidth.current)
    onWidthChange(pendingWidth.current)
  }
  // An inspection brings the resource to the front; the Profile tab stays and follows it.
  useEffect(() => { if (inspection > 0) setTab((current) => (current === 'profile' ? current : 'resource')) }, [inspection])

  return (
    // Not modal: the app stays usable while the panel is open, so every click shows its FHIR.
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <Theme asChild accentColor="blue" grayColor="slate" radius="medium" appearance="light">
        <SheetContent
          ref={panelElement}
          side="right"
          className="fhir-panel"
          style={{ '--fhir-panel-width': `${width}px` } as CSSProperties}
          onInteractOutside={(e) => e.preventDefault()}
          // Keep the focus in the app: the panel follows the app and should not take the focus from it.
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div
            className="fhir-panel-divider" role="separator" aria-orientation="vertical"
            aria-label={t('resizeFhirPanel')} aria-valuenow={width} aria-valuemin={280}
            tabIndex={0}
            onPointerDown={(event) => { event.preventDefault()
              event.currentTarget.focus()
              activePointer.current = event.pointerId
              pendingWidth.current = width
              dragging.current = true
              panelElement.current?.setAttribute('data-resizing', 'true')
              onResizingChange(true)
              event.currentTarget.setPointerCapture(event.pointerId)

            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) resize(Math.max(280, Math.min(window.innerWidth - 320, window.innerWidth - event.clientX)))
            }}
            onPointerCancel={() => { pendingWidth.current = width }}
            onLostPointerCapture={finishResize}
            onKeyDown={(event) => {
              if (dragging.current && event.key === 'Escape' && activePointer.current !== undefined) {
                event.preventDefault()
                pendingWidth.current = width
                event.currentTarget.releasePointerCapture(activePointer.current)
                return
              }
              if (dragging.current || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
              event.preventDefault()
              onWidthChange(Math.max(280, Math.min(window.innerWidth - 320, width + (event.key === 'ArrowLeft' ? 32 : -32))))
            }}
          />
          <SheetHeader className="fhir-panel-header">
            <SheetTitle>FHIR</SheetTitle>
            <SheetDescription>{t('panelDescription')}</SheetDescription>
          </SheetHeader>
          <Tabs.Root value={tab} onValueChange={setTab} className="fhir-panel-tabs">
            <Tabs.List className="fhir-panel-tablist">
              <Tabs.Trigger value="resource">{t('panelResource')}</Tabs.Trigger>
              <Tabs.Trigger value="profile">{t('panelProfile')}</Tabs.Trigger>
              <Tabs.Trigger value="requests">{t('panelRequests')}</Tabs.Trigger>
              <Tabs.Trigger value="downloads">{t('panelDownloads')}</Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="resource" className="fhir-panel-tab">
              {/* The version is part of the key: a saved change starts without the old $validate result. */}
              {resource ? <ResourceView key={`${resource.resourceType}/${resource.id}/${resource.meta?.versionId ?? ''}`} resource={resource} /> : (
                <p className="fhir-panel-empty">{t('panelEmpty')}</p>
              )}
            </Tabs.Content>
            <Tabs.Content value="profile" className="fhir-panel-tab">
              {resource ? <ProfileView key={`${resource.resourceType}/${resource.id}`} resource={resource} /> : (
                <p className="fhir-panel-empty">{t('panelProfileEmpty')}</p>
              )}
            </Tabs.Content>
            <Tabs.Content value="downloads" className="fhir-panel-tab">
              <div className="fhir-panel-body fhir-downloads">
                {patient && <DownloadButton label={`${t('patient')}: ${patientName(patient)}`} title={t('downloadPatientTitle')} onDownload={() => downloadPatient(patient)} />}
                {carePlans.map((plan) => <DownloadButton key={plan.id} label={plan.title ?? plan.id} title={t('downloadPlanTitle')} onDownload={() => downloadPlan(plan)} />)}
              </div>
            </Tabs.Content>
            <Tabs.Content value="requests" className="fhir-panel-tab">
              <RequestLog />
            </Tabs.Content>
          </Tabs.Root>
        </SheetContent>
      </Theme>
    </Sheet>
  )
}

function shortProfile(url: string): string {
  return url.split('/').pop()?.split('|')[0] ?? url
}

function ResourceView({ resource }: { resource: Resource }) {
  const [outcome, setOutcome] = useState<OperationOutcome>()
  const [validating, setValidating] = useState(false)
  const [error, setError] = useState<string>()
  const profiles = resource.meta?.profile ?? []
  const failed = outcome?.issue.some((i) => i.severity === 'error' || i.severity === 'fatal')
  // Aidbox answers a clean resource with one "all ok" information issue; show anything beyond it.
  const notable = outcome?.issue.some((i) => i.severity !== 'information' || i.diagnostics !== 'all ok')

  const validate = () => {
    setValidating(true)
    setError(undefined)
    validateResource(resource)
      .then(setOutcome)
      .catch((e: Error) => setError(e.message))
      .finally(() => setValidating(false))
  }

  return (
    <div className="fhir-panel-body">
      <div className="fhir-panel-toolbar">
        <code className="fhir-panel-ref">{resource.resourceType}/{resource.id}</code>
        <Button size="2" variant="solid" onClick={validate} disabled={validating} aria-busy={validating}>
          {validating && <Spinner className="app-spinner" role="status" aria-label={t('validating')} />}
          {validating ? t('validating') : '$validate'}
        </Button>
        <Button size="2" variant="outline" asChild>
          <a href={aidboxUiUrl(resource)} target="_blank" rel="noreferrer">{t('openAidbox')}</a>
        </Button>
      </div>
      <div className="fhir-panel-profiles">
        {profiles.length === 0 && <span className="fhir-panel-muted">{t('noProfile')}</span>}
        {profiles.map((p) => (
          <Badge key={p} size="1" color="blue" title={p}>{shortProfile(p)}</Badge>
        ))}
      </div>
      {error && <p className="fhir-panel-error">{error}</p>}
      {outcome && !failed && (
        <p className="fhir-panel-ok">
          {t('validResource', { profiles: profiles.length ? t('againstProfiles', { profiles: profiles.map(shortProfile).join(', ') }) : '' })}
        </p>
      )}
      {outcome && notable && <OperationOutcomeView resource={outcome} />}
      <div className="fhir-panel-editor">
        <CodeEditor readOnly isReadOnlyTheme mode="json" currentValue={JSON.stringify(resource, null, 2)} />
      </div>
    </div>
  )
}

function statusColor(entry: FhirLogEntry): 'green' | 'red' | 'gray' {
  if (entry.error || (entry.status ?? 0) >= 400) return 'red'
  return entry.status ? 'green' : 'gray'
}

function RequestLog() {
  const [entries, setEntries] = useState<readonly FhirLogEntry[]>([])
  const [selectedId, setSelectedId] = useState<number>()
  useEffect(() => subscribeFhirLog(setEntries), [])
  const selected = entries.find((e) => e.id === selectedId) ?? entries[0]

  return (
    <div className="fhir-panel-body">
      <div className="fhir-panel-toolbar">
        <span className="fhir-panel-muted">{t('requestCount', { count: entries.length })}</span>
        <Button size="2" variant="outline" onClick={() => { clearFhirLog(); setSelectedId(undefined) }}>{t('clear')}</Button>
      </div>
      <ul className="fhir-panel-log">
        {entries.map((entry) => (
          <li key={entry.id}>
            <Button type="button" variant="ghost" className={entry === selected ? 'selected' : ''} onClick={() => setSelectedId(entry.id)}>
              <Badge size="1" color={statusColor(entry)}>{entry.error ? 'ERR' : (entry.status ?? '...')}</Badge>
              <strong>{entry.method}</strong>
              <span className="fhir-panel-url">{decodeURIComponent(entry.url)}</span>
              <span className="fhir-panel-muted">{entry.durationMs !== undefined ? `${entry.durationMs} ms` : ''}</span>
            </Button>
          </li>
        ))}
      </ul>
      {selected && (
        <div className="fhir-panel-editor">
          <CodeEditor
            readOnly
            isReadOnlyTheme
            mode="json"
            currentValue={JSON.stringify(selected.error ? { error: selected.error } : (selected.responseBody ?? null), null, 2)}
          />
        </div>
      )}
    </div>
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
      <Button type="button" variant="outline" title={title} onClick={click} disabled={busy} aria-busy={busy}>
        {busy ? <Spinner className="app-spinner" role="status" aria-label={t('preparing')} /> : (<Download size={18} aria-hidden="true" />)}
        {busy ? t('preparing') : label}
      </Button>
      {error && <span role="alert" className="error">{error}</span>}
    </span>
  )
}
