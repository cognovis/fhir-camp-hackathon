// Builds catalog/goz-catalog.bundle.json, the GOZ catalog the hackathon loads into Aidbox
// and feeds to the Billing SDK.
//
// Input:  catalog/source/goz-adapter-output.json  (one run of the GOZ converter on the
//         official BMJV XML, committed as generated)
//         billing/goz-hackathon-rules.json         (the hand-written hackathon rule set)
// Output: catalog/goz-catalog.bundle.json          (FHIR transaction Bundle)
//
// What it changes compared with the converter output, and why:
// - Price: the converter writes the GOZ points as priceComponent.factor and the point value
//   (0.0562421 EUR) as priceComponent.amount. The Billing SDK reads a base amount as the line's
//   unit price, and it only accepts amounts with at most two decimals, so that shape gives
//   `unavailable` (SNAPSHOT_MALFORMED, money-invalid). Here the base amount is the single fee
//   (points x point value, rounded to cents) and the points and point value move to
//   informational components, which the SDK ignores.
// - Ids and versions: ids become `goz-<code>`, and the version gets a `-hackathon.1` suffix,
//   because the content is no longer the converter's.
// - Libraries: the converter's catalog-edition and per-code factor-bound Libraries are replaced
//   by one edition with the native source-based rules. A separately bound contextual Library
//   carries the GOZ checks the pinned SDK cannot execute itself.
//
// Generated for the hackathon, not a billing-grade catalog.

import { readFileSync, writeFileSync } from 'node:fs'
import { buildBillingLibrary, billingCatalogDefinitionDigest } from '@cognovis/fhir-billing-rules'
import { buildContextLibrary } from './goz-context.mjs'

const POINT_VALUE_EUR = 0.0562421
const GOZ_SYSTEM = 'http://fhir.de/CodeSystem/bzaek/goz'
const PRICE_COMPONENT_SYSTEM = 'https://github.com/cognovis/fhir-camp-hackathon/CodeSystem/goz-price-component'
const KIT_BASE = 'https://github.com/cognovis/fhir-camp-hackathon'
const VERSION_SUFFIX = '-hackathon.1'
const NOT_BILLING_GRADE = 'Generated for the FHIR Camp hackathon, not a billing-grade catalog.'

const root = new URL('..', import.meta.url)
const source = JSON.parse(readFileSync(new URL('catalog/source/goz-adapter-output.json', root), 'utf8'))
const rulePayload = JSON.parse(readFileSync(new URL('billing/goz-hackathon-rules.json', root), 'utf8'))
const resources = source.entry.map((entry) => entry.resource)

const sourceEdition = resources.find((resource) => resource.resourceType === 'Library'
  && resource.identifier?.some((identifier) => identifier.value === 'catalog-edition'))
const sourceManifest = JSON.parse(Buffer.from(sourceEdition.content[0].data, 'base64').toString('utf8'))
const period = sourceEdition.effectivePeriod

function cents(value) {
  return Math.round(value * 100) / 100
}

function hackathonMeta() {
  return {
    source: `${KIT_BASE}/catalog`,
    tag: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'HTEST', display: 'test health data' }],
  }
}

function convertDefinition(definition) {
  const code = definition.code.coding[0].code
  const base = definition.propertyGroup?.[0]?.priceComponent?.find((component) => component.type === 'base')
  const points = base?.factor
  const converted = {
    resourceType: 'ChargeItemDefinition',
    id: `goz-${code}`,
    meta: hackathonMeta(),
    url: definition.url,
    version: `${definition.version}${VERSION_SUFFIX}`,
    title: definition.title,
    status: definition.status,
    description: definition.description,
    effectivePeriod: definition.effectivePeriod,
    code: definition.code,
  }
  if (typeof points === 'number') {
    converted.propertyGroup = [{
      priceComponent: [
        { type: 'base', amount: { value: cents(points * POINT_VALUE_EUR), currency: 'EUR' } },
        { type: 'informational', code: { coding: [{ system: PRICE_COMPONENT_SYSTEM, code: 'points', display: 'GOZ points' }] }, factor: points },
        { type: 'informational', code: { coding: [{ system: PRICE_COMPONENT_SYSTEM, code: 'point-value', display: 'GOZ point value in EUR' }] }, factor: POINT_VALUE_EUR },
      ],
    }]
  }
  // A GOZ number without points (for example 2230, 2240) keeps no price: GOZ prices it as a share
  // of another number. Billing such a line gives `unavailable` in the SDK.
  converted.identifier = [{ system: 'https://fhir.cognovis.de/billing-core/sid/catalog-digest', value: billingCatalogDefinitionDigest(converted) }]
  return converted
}

const definitions = resources
  .filter((resource) => resource.resourceType === 'ChargeItemDefinition')
  .map(convertDefinition)

const codeSystem = resources.find((resource) => resource.resourceType === 'CodeSystem')
const hackathonCodeSystem = {
  ...codeSystem,
  id: 'goz',
  meta: hackathonMeta(),
  description: `GOZ Anlage 1 numbers decoded from the official BMJV XML. ${NOT_BILLING_GRADE}`,
}

const ruleSet = buildBillingLibrary({
  kind: 'rule-set',
  id: 'goz-hackathon-rules',
  url: `${KIT_BASE}/Library/goz-hackathon-rules`,
  version: '2026.11.1',
  status: 'active',
  publisher: 'FHIR Camp: source-based GOZ checks',
  effectivePeriod: period,
  payload: rulePayload,
  relatedArtifacts: [],
})

const edition = buildBillingLibrary({
  kind: 'catalog-edition',
  id: 'goz-hackathon-edition',
  url: `${KIT_BASE}/Library/goz-hackathon-edition`,
  version: `${sourceEdition.version}${VERSION_SUFFIX}`,
  status: 'active',
  publisher: 'FHIR Camp hackathon (generated from BMJV GOZ XML)',
  effectivePeriod: period,
  payload: { ...sourceManifest, sources: sourceManifest.sources.map((entry) => ({ ...entry, producerVersion: `${entry.producerVersion}${VERSION_SUFFIX}` })) },
  catalogDefinitions: definitions,
  relatedArtifacts: [
    ...definitions.map((definition) => ({ type: 'composed-of', resource: `${definition.url}|${definition.version}` })),
    { type: 'composed-of', resource: `${ruleSet.url}|${ruleSet.version}` },
  ],
})

const contextPayload = JSON.parse(readFileSync(new URL('billing/goz-context-rules.json', root), 'utf8'))
const contextLibrary = buildContextLibrary(contextPayload, edition, hackathonMeta())
const out = [contextLibrary, hackathonCodeSystem, { ...ruleSet, meta: hackathonMeta(), description: `Source-based native GOZ checks. ${NOT_BILLING_GRADE}` }, { ...edition, meta: hackathonMeta(), description: NOT_BILLING_GRADE }, ...definitions]
const bundle = {
  resourceType: 'Bundle',
  id: 'goz-hackathon-catalog',
  type: 'transaction',
  entry: out.map((resource) => ({
    fullUrl: `urn:uuid:${resource.resourceType}-${resource.id}`,
    resource,
    request: { method: 'PUT', url: `${resource.resourceType}/${resource.id}` },
  })),
}
writeFileSync(new URL('catalog/goz-catalog.bundle.json', root), `${JSON.stringify(bundle, null, 1)}\n`)
console.log(`catalog/goz-catalog.bundle.json: ${definitions.length} ChargeItemDefinitions, 1 CodeSystem, native rule set ${ruleSet.version}, context rules ${contextPayload.version}, edition ${edition.version}`)
