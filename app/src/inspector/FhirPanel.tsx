// The FHIR panel: shows the FHIR layer behind the app while you use it. It is built from the
// Health Samurai React Components (MIT), the library the Aidbox UI itself is made of, so the
// panel looks and reads like the Aidbox console:
// - "Resource": the resource you clicked in the app as FHIR JSON, its profiles, a $validate
//   button with the OperationOutcome, and a link to the same resource in the Aidbox UI.
// - "Profile": the profile the resource claims, as the element tree the Aidbox UI shows.
// - "Requests": every FHIR request the app sent (fhirRequest in fhir.ts) with its response.

import { useEffect, useState } from 'react'
import {
  Button,
  CodeEditor,
  OperationOutcomeView,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tag,
} from '@health-samurai/react-components'
import { clearFhirLog, subscribeFhirLog, validateResource, type FhirLogEntry, type OperationOutcome, type Resource } from '../fhir'
import { ProfileView } from './ProfileView'

declare const __AIDBOX_BROWSER_URL__: string

export function aidboxUiUrl(resource: Resource): string {
  return `${__AIDBOX_BROWSER_URL__}/u/resource/${resource.resourceType}/edit/${encodeURIComponent(resource.id)}`
}

export interface FhirPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  resource?: Resource
  /** Increases with every inspection, also of the same resource again. */
  inspection: number
}

export function FhirPanel({ open, onOpenChange, resource, inspection }: FhirPanelProps) {
  const [tab, setTab] = useState('resource')
  // An inspection brings the resource to the front; the Profile tab stays and follows it.
  useEffect(() => { if (inspection > 0) setTab((current) => (current === 'profile' ? current : 'resource')) }, [inspection])

  return (
    // Not modal: the app stays usable while the panel is open, so every click shows its FHIR.
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        className={tab === 'profile' ? 'fhir-panel wide' : 'fhir-panel'}
        onInteractOutside={(e) => e.preventDefault()}
        // Keep the focus in the app: the panel follows the app and should not take the focus from it.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SheetHeader className="fhir-panel-header">
          <SheetTitle>FHIR</SheetTitle>
          <SheetDescription>The FHIR layer behind the app, live from Aidbox.</SheetDescription>
        </SheetHeader>
        <Tabs value={tab} onValueChange={setTab} className="fhir-panel-tabs">
          <TabsList className="fhir-panel-tablist">
            <TabsTrigger value="resource">Resource</TabsTrigger>
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="requests">Requests</TabsTrigger>
          </TabsList>
          <TabsContent value="resource" className="fhir-panel-tab">
            {/* The version is part of the key: a saved change starts without the old $validate result. */}
            {resource ? <ResourceView key={`${resource.resourceType}/${resource.id}/${resource.meta?.versionId ?? ''}`} resource={resource} /> : (
              <p className="fhir-panel-empty">Click "View FHIR", a GOZ number in a cost plan, or a tooth in the chart.</p>
            )}
          </TabsContent>
          <TabsContent value="profile" className="fhir-panel-tab">
            {resource ? <ProfileView key={`${resource.resourceType}/${resource.id}`} resource={resource} /> : (
              <p className="fhir-panel-empty">Open a resource first; this tab shows the profile it claims.</p>
            )}
          </TabsContent>
          <TabsContent value="requests" className="fhir-panel-tab">
            <RequestLog />
          </TabsContent>
        </Tabs>
      </SheetContent>
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
        <Button size="small" variant="primary" onClick={validate} disabled={validating}>
          {validating ? 'Validating...' : '$validate'}
        </Button>
        <Button size="small" variant="secondary" asChild>
          <a href={aidboxUiUrl(resource)} target="_blank" rel="noreferrer">Open in Aidbox</a>
        </Button>
      </div>
      <div className="fhir-panel-profiles">
        {profiles.length === 0 && <span className="fhir-panel-muted">No meta.profile: validated against base FHIR R4.</span>}
        {profiles.map((p) => (
          <Tag key={p} size="small" shape="round" color="blue" vibrance="subtle" title={p}>{shortProfile(p)}</Tag>
        ))}
      </div>
      {error && <p className="fhir-panel-error">{error}</p>}
      {outcome && !failed && (
        <p className="fhir-panel-ok">
          Valid{profiles.length ? ` against ${profiles.map(shortProfile).join(', ')}` : ''}.
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
        <span className="fhir-panel-muted">{entries.length} requests, newest first</span>
        <Button size="small" variant="secondary" onClick={() => { clearFhirLog(); setSelectedId(undefined) }}>Clear</Button>
      </div>
      <ul className="fhir-panel-log">
        {entries.map((entry) => (
          <li key={entry.id}>
            <button type="button" className={entry === selected ? 'selected' : ''} onClick={() => setSelectedId(entry.id)}>
              <Tag size="small" shape="square" color={statusColor(entry)} vibrance="subtle">{entry.error ? 'ERR' : (entry.status ?? '...')}</Tag>
              <strong>{entry.method}</strong>
              <span className="fhir-panel-url">{decodeURIComponent(entry.url)}</span>
              <span className="fhir-panel-muted">{entry.durationMs !== undefined ? `${entry.durationMs} ms` : ''}</span>
            </button>
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
