import { readFileSync } from 'node:fs'
import { bundleAdmissionRecords, createBundleFhirClient, evaluateBillingAccount } from '@cognovis/fhir-billing-sdk'
import { defineProfile } from '@cognovis/fhir-sdk/client'
import { evaluateContext } from './goz-context.mjs'

const root = new URL('..', import.meta.url)
const base = (type) => defineProfile({ canonicalUrl: `http://hl7.org/fhir/StructureDefinition/${type}`, from: (r) => r, createResource: () => ({ resourceType: type }) }, type)
const profiles = Object.fromEntries(Object.entries({ account: 'Account', chargeItem: 'ChargeItem', coverage: 'Coverage', contract: 'Contract', observation: 'Observation', catalogEdition: 'Library', ruleSet: 'Library', catalogDefinition: 'ChargeItemDefinition', admission: 'Provenance', patient: 'Patient', encounter: 'Encounter', condition: 'Condition', practitioner: 'Practitioner', practitionerRole: 'PractitionerRole' }).map(([key, type]) => [key, base(type)]))
export const loadCatalog = () => JSON.parse(readFileSync(new URL('catalog/goz-catalog.bundle.json', root), 'utf8'))

export async function loadCases({ bundlePath, patientId } = {}) {
  if (!patientId) return JSON.parse(readFileSync(bundlePath ?? new URL('data/dent-051-palmried.json', root), 'utf8'))
  const baseUrl = new URL(process.env.AIDBOX_URL ?? `http://localhost:${process.env.AIDBOX_PORT ?? '8080'}`)
  if (!['localhost', '127.0.0.1', '[::1]', 'aidbox'].includes(baseUrl.hostname) || baseUrl.username || baseUrl.password) throw new Error('This demo only supports the local Aidbox')
  const fhirRoot = `${baseUrl.href.replace(/\/$/, '')}/fhir/`
  const auth = `Basic ${Buffer.from(`${process.env.AIDBOX_CLIENT ?? 'root'}:${process.env.AIDBOX_SECRET ?? 'hackathon'}`).toString('base64')}`
  async function get(url, optional = false) {
    const parsed = new URL(url, fhirRoot)
    if (parsed.origin !== baseUrl.origin || !parsed.href.startsWith(fhirRoot)) throw new Error('Refusing a non-local FHIR link')
    const response = await fetch(parsed, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { authorization: auth, accept: 'application/fhir+json' } })
    if (optional && response.status === 404) return undefined
    if (!response.ok) throw new Error(`FHIR GET failed: HTTP ${response.status}`)
    return response.json()
  }
  const stored = new Map()
  function add(resource) {
    if (!resource?.resourceType || !resource.id) throw new Error('Malformed FHIR resource')
    const key = `${resource.resourceType}/${resource.id}`
    if (stored.has(key) && JSON.stringify(stored.get(key)) !== JSON.stringify(resource)) throw new Error(`Inconsistent resource ${key}`)
    stored.set(key, resource)
  }
  async function search(query) {
    let url = query, count = 0, total
    const seen = new Set(), identities = new Set()
    while (url) {
      const resolved = new URL(url, fhirRoot).href
      if (seen.has(resolved)) throw new Error('FHIR pagination cycle')
      seen.add(resolved)
      const page = await get(resolved)
      if (page.resourceType !== 'Bundle' || page.type !== 'searchset') throw new Error('Expected a complete FHIR searchset')
      if (page.total !== undefined) {
        if (total !== undefined && total !== page.total) throw new Error('FHIR total changed during pagination')
        total = page.total
      }
      for (const entry of page.entry ?? []) {
        if (entry.search?.mode === 'include' || entry.search?.mode === 'outcome') continue
        const resource = entry.resource, key = `${resource?.resourceType}/${resource?.id}`
        if (identities.has(key)) throw new Error('Duplicate resource across FHIR pages')
        identities.add(key); add(resource); count += 1
      }
      const next = (page.link ?? []).filter((l) => l.relation === 'next')
      if (next.length > 1) throw new Error('Ambiguous FHIR next link')
      url = next[0]?.url
    }
    if (total !== undefined && total !== count) throw new Error('Incomplete FHIR search result')
  }
  const patient = encodeURIComponent(`Patient/${patientId}`)
  await search(`Account?subject=${patient}&_count=100`)
  await search(`ChargeItem?subject=${patient}&_count=100`)
  await search(`Coverage?beneficiary=${patient}&_count=100`)
  const p = await get(`Patient/${encodeURIComponent(patientId)}`, true)
  if (p) add(p)
  // Only follow evidence references needed by this patient's billing graph.
  const pending = new Set(), visited = new Set()
  function collect(value) {
    if (Array.isArray(value)) value.forEach(collect)
    else if (value && typeof value === 'object') {
      if (typeof value.reference === 'string' && /^(Observation|Encounter|Contract|DocumentReference)\/[A-Za-z0-9.-]+$/.test(value.reference)) pending.add(value.reference)
      if (value.resourceType === 'Observation' && value.code?.coding?.some((c) => c.system === 'https://github.com/cognovis/fhir-camp-hackathon/CodeSystem/goz-evidence' && ['agreementDocument', 'requestAgreementDocument'].includes(c.code)) && /^DocumentReference\/[A-Za-z0-9.-]+$/.test(value.valueString ?? '')) pending.add(value.valueString)
      Object.values(value).filter((v) => v && typeof v === 'object').forEach(collect)
    }
  }
  for (const r of stored.values()) collect(r)
  while (pending.size) {
    const ref = pending.values().next().value; pending.delete(ref)
    if (visited.has(ref) || stored.has(ref)) continue
    visited.add(ref)
    const r = await get(ref, true)
    if (r) { add(r); collect(r) }
  }
  return { resourceType: 'Bundle', type: 'collection', entry: [...stored.values()].map((resource) => ({ resource })) }
}

export async function evaluateGozAccount({ catalog, cases, account, asOf = '2026-11-16' }) {
  const bundles = [catalog, cases]
  const admissions = bundleAdmissionRecords(bundles, { tenant: 'standalone' })
  const client = createBundleFhirClient([...bundles, { resourceType: 'Bundle', type: 'collection', entry: admissions.map((resource) => ({ resource })) }])
  const native = await evaluateBillingAccount({ client, profiles, tenant: 'standalone', asOf, account })
  const context = evaluateContext({ catalog, cases, account, asOf })
  const findings = [
    ...(native.reasons ?? []).filter((r) => !['ELIGIBLE', 'CATALOG_PARTIAL'].includes(r.code)).map((r) => ({ code: r.code, rule: r.ruleId ?? r.details?.ruleId, line: r.lineId ?? r.details?.lineId, effect: r.effect ?? 'needs-review', details: r.details, message: r.explanation?.key, sources: r.sources, origin: 'sdk' })),
    ...context.findings.map((f) => ({ ...f, origin: 'goz-context' })),
  ]
  const decision = native.decision === 'block' || context.findings.some((f) => f.effect === 'reject') ? 'block'
    : native.decision !== 'allow' || context.findings.length ? 'unavailable' : 'allow'
  return { account, decision, nativeDecision: native.decision, contextLibrary: context.library, findings, case: native.case, prices: context.prices }
}
