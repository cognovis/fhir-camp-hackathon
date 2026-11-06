import { useTranslation } from 'react-i18next'
import { t } from '../i18n.ts'
// The profile of the inspected resource as a tree, drawn with FhirStructureView from
// @health-samurai/react-components (the same view the Aidbox UI uses for profiles). The
// StructureDefinition comes from Aidbox through the /fhir proxy; toStructureTree turns its
// snapshot into the tree the view expects.

import { useEffect, useState } from 'react'
import { FhirStructureView, type FhirStructure, type TreeViewItem } from '@health-samurai/react-components'
import { search, type Resource } from '../fhir'

interface ElementDefinition {
  id: string
  path: string
  min?: number
  max?: string
  short?: string
  definition?: string
  mustSupport?: boolean
  isModifier?: boolean
  isSummary?: boolean
  type?: { code: string; profile?: string[]; targetProfile?: string[] }[]
  binding?: { strength?: string; valueSet?: string }
}

interface StructureDefinition extends Resource {
  url: string
  name?: string
  title?: string
  snapshot?: { element: ElementDefinition[] }
}

type Tree = Record<string, TreeViewItem<FhirStructure>>

const lastSegment = (id: string) => id.slice(id.lastIndexOf('.') + 1)
const parentOf = (id: string) => id.slice(0, id.lastIndexOf('.'))
const tail = (url: string) => url.split('/').pop()?.split('|')[0] ?? url

function typeLabel(element: ElementDefinition): string {
  return (element.type ?? [])
    .map((t) => {
      const code = t.code.startsWith('http://hl7.org/fhirpath/System.') ? t.code.slice(31).toLowerCase() : t.code
      if (t.targetProfile?.length) return `${code}(${t.targetProfile.map(tail).join(' | ')})`
      if (code === 'Extension' && t.profile?.length) return `Extension(${t.profile.map(tail).join(' | ')})`
      return code
    })
    .join(' | ')
}

// Plumbing every element carries (id, extension, modifierExtension) is left out unless the
// profile does something with it (a slice or a fixed extension); prohibited elements (max 0) too.
function isNoise(element: ElementDefinition): boolean {
  if (element.max === '0') return true
  const name = lastSegment(element.id)
  if (name.includes(':')) return false
  if (element.type?.some((t) => t.profile?.length)) return false
  return name === 'id' || name === 'extension' || name === 'modifierExtension'
}

export function toStructureTree(sd: StructureDefinition): Tree {
  const elements = sd.snapshot?.element ?? []
  const tree: Tree = { root: { name: 'Root', children: [] } }
  const kept = new Set<string>()
  for (const element of elements) {
    const isRoot = !element.id.includes('.')
    const parent = isRoot ? 'root' : parentOf(element.id)
    // Children of a dropped element are dropped with it.
    if (!isRoot && (!kept.has(parent) || isNoise(element))) continue
    kept.add(element.id)
    const typeCodes = element.type?.map((t) => t.code) ?? []
    tree[element.id] = {
      name: isRoot ? (sd.title ?? sd.name ?? element.id) : lastSegment(element.id),
      meta: {
        type: isRoot ? 'Resource' : typeCodes.length > 1 ? 'union' : typeLabel(element) || 'BackboneElement',
        datatype: typeLabel(element),
        min: element.min === undefined ? undefined : String(element.min),
        max: element.max,
        short: element.short,
        desc: element.definition,
        mustSupport: element.mustSupport,
        isModifier: element.isModifier,
        isSummary: element.isSummary,
        ...(element.binding?.valueSet ? { binding: { valueSet: `${tail(element.binding.valueSet)} (${element.binding.strength ?? 'binding'})` } } : {}),
        ...(typeCodes[0] === 'Extension' && element.type?.[0]?.profile?.[0] ? { extensionUrl: element.type[0].profile[0] } : {}),
      },
    }
    const parentNode = tree[parent]
    parentNode.children = [...(parentNode.children ?? []), element.id]
  }
  // A choice element (value[x]) shows its types in the type column instead of the word "union".
  for (const node of Object.values(tree)) {
    if (node.meta?.type === 'union' && node.meta.datatype) node.meta = { ...node.meta, type: node.meta.datatype }
  }
  return tree
}

export function profileUrls(resource: Resource): string[] {
  const profiles = resource.meta?.profile ?? []
  return profiles.length ? profiles : [`http://hl7.org/fhir/StructureDefinition/${resource.resourceType}`]
}

export function ProfileView({ resource }: { resource: Resource }) {
  useTranslation()
  const urls = profileUrls(resource)
  const [url, setUrl] = useState(urls[0])
  const [sd, setSd] = useState<StructureDefinition>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    let current = true
    setSd(undefined)
    setError(undefined)
    const bare = url.split('|')[0]
    search<StructureDefinition>(`StructureDefinition?url=${encodeURIComponent(bare)}`)
      .then((found) => {
        if (!current) return
        if (found[0]?.snapshot) setSd(found[0])
        else setError(t('profileMissing', { url: bare }))
      })
      .catch((e: Error) => { if (current) setError(e.message) })
    return () => { current = false }
  }, [url])

  return (
    <div className="fhir-panel-body">
      <div className="fhir-panel-toolbar">
        {urls.length > 1 ? (
          <select value={url} onChange={(e) => setUrl(e.target.value)} className="fhir-panel-select">
            {urls.map((u) => <option key={u} value={u}>{tail(u)}</option>)}
          </select>
        ) : (
          <code className="fhir-panel-ref">{tail(url)}</code>
        )}
        <a className="fhir-panel-muted" href={url.split('|')[0]} target="_blank" rel="noreferrer">{url.split('|')[0]}</a>
      </div>
      <p className="fhir-panel-muted">
        {t('profileInfo')}
      </p>
      {error && <p className="fhir-panel-error">{error}</p>}
      {!sd && !error && <p className="fhir-panel-muted">{t('profileLoading')}</p>}
      {sd && (
        <div className="fhir-panel-structure">
          <FhirStructureView key={sd.url} tree={toStructureTree(sd)} />
        </div>
      )}
    </div>
  )
}
