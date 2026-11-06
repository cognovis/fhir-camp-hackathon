#!/usr/bin/env node
// Cost plan per treatment alternative: evaluates every cost plan Account of a patient with the
// Billing SDK (`evaluateBillingAccount`) and prints the priced lines.
//
// The `fhir-billing-check` CLI prints decisions only. Line prices come from the SDK result:
// `result.case.lines[]` carries `unitPrice` (the single GOZ fee from the catalog definition)
// and `actualMultiplier` (ChargeItem.factorOverride) for every line.
//
// Usage:
//   node cost-plan.mjs                         reads ../data/dent-051-palmried.json
//   node cost-plan.mjs --bundle <file>         reads another patient bundle
//   node cost-plan.mjs --aidbox <patient-id>   reads the patient's Accounts, ChargeItems,
//                                              Coverage and Contract from the local Aidbox
//   add --json for machine-readable output.
//
// Generated for the hackathon, not a billing-grade calculation.

import { existsSync, readFileSync } from 'node:fs'
import { bundleAdmissionRecords, createBundleFhirClient, evaluateBillingAccount } from '@cognovis/fhir-billing-sdk'
import { defineProfile } from '@cognovis/fhir-sdk/client'

// Read AIDBOX_PORT and the other settings from the repository's .env, as Docker Compose does.
// Variables already set in the environment win.
const envFile = new URL('../.env', import.meta.url)
if (existsSync(envFile)) process.loadEnvFile?.(envFile)

const args = process.argv.slice(2)
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const asJson = args.includes('--json')
const root = new URL('..', import.meta.url)
const AS_OF = option('--as-of') ?? '2026-11-16'

// Base R4 profiles: the bundle resources are read as they are, as the CLI does.
const base = (type) => defineProfile({ canonicalUrl: `http://hl7.org/fhir/StructureDefinition/${type}`, from: (r) => r, createResource: () => ({ resourceType: type }) }, type)
const profiles = {
  account: base('Account'), chargeItem: base('ChargeItem'), coverage: base('Coverage'), contract: base('Contract'),
  observation: base('Observation'), catalogEdition: base('Library'), ruleSet: base('Library'),
  catalogDefinition: base('ChargeItemDefinition'), admission: base('Provenance'), patient: base('Patient'),
  encounter: base('Encounter'), condition: base('Condition'), practitioner: base('Practitioner'), practitionerRole: base('PractitionerRole'),
}

async function fromAidbox(patientId) {
  const url = (process.env.AIDBOX_URL ?? `http://localhost:${process.env.AIDBOX_PORT ?? '8080'}`).replace(/\/$/, '')
  const auth = `Basic ${Buffer.from(`${process.env.AIDBOX_CLIENT ?? 'root'}:${process.env.AIDBOX_SECRET ?? 'hackathon'}`).toString('base64')}`
  const search = async (query) => {
    const response = await fetch(`${url}/fhir/${query}`, { headers: { authorization: auth, accept: 'application/fhir+json' } })
    if (!response.ok) throw new Error(`GET ${query}: HTTP ${response.status}`)
    return ((await response.json()).entry ?? []).map((entry) => entry.resource)
  }
  const accounts = await search(`Account?subject=Patient/${patientId}&_count=100`)
  const charges = await search(`ChargeItem?subject=Patient/${patientId}&_count=1000`)
  const coverages = await search(`Coverage?beneficiary=Patient/${patientId}&_count=100`)
  const contractIds = coverages.flatMap((c) => c.contract ?? []).map((r) => r.reference.split('/')[1])
  const contracts = contractIds.length ? await search(`Contract?_id=${contractIds.join(',')}`) : []
  return { resourceType: 'Bundle', type: 'collection', entry: [...accounts, ...charges, ...coverages, ...contracts].map((resource) => ({ resource })) }
}

const catalog = JSON.parse(readFileSync(new URL('catalog/goz-catalog.bundle.json', root), 'utf8'))
const patientId = option('--aidbox')
const cases = patientId
  ? await fromAidbox(patientId)
  : JSON.parse(readFileSync(option('--bundle') ?? new URL('data/dent-051-palmried.json', root), 'utf8'))

// GOZ points per code, for the exact fee: points x point value x multiplier, rounded to cents.
const definitions = catalog.entry.map((e) => e.resource).filter((r) => r.resourceType === 'ChargeItemDefinition')
const informational = (definition, code) => definition.propertyGroup?.[0]?.priceComponent
  ?.find((c) => c.type === 'informational' && c.code?.coding?.[0]?.code === code)?.factor
const points = new Map(definitions.map((d) => [d.code.coding[0].code, { points: informational(d, 'points'), pointValue: informational(d, 'point-value') }]))

const resources = cases.entry.map((e) => e.resource)
const chargeItems = new Map(resources.filter((r) => r.resourceType === 'ChargeItem').map((r) => [r.id, r]))
const accounts = resources.filter((r) => r.resourceType === 'Account').sort((a, b) => a.id.localeCompare(b.id))

const bundles = [catalog, cases]
const tenant = 'standalone'
const admissions = bundleAdmissionRecords(bundles, { tenant })
const client = createBundleFhirClient([...bundles, { resourceType: 'Bundle', type: 'collection', entry: admissions.map((resource) => ({ resource })) }])

const cents = (value) => Math.round(value * 100) / 100
const euro = (value) => value.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
const plans = []
for (const account of accounts) {
  const result = await evaluateBillingAccount({ client, profiles, tenant, asOf: AS_OF, account: account.id })
  const lines = (result.case?.lines ?? []).map((line) => {
    const item = chargeItems.get(line.id)
    const p = points.get(line.code.code)
    const factor = line.actualMultiplier ?? 1
    const unit = line.unitPrice ? Number(line.unitPrice.value) : undefined
    // GOZ § 5: fee = points x point value x multiplier, rounded to cents, per unit.
    const fee = p?.points !== undefined ? cents(p.points * p.pointValue * factor) : unit !== undefined ? cents(unit * factor) : undefined
    return {
      id: line.id, code: line.code.code, display: item?.code?.coding?.[0]?.display ?? '',
      tooth: item?.bodysite?.[0]?.coding?.[0]?.code ?? '', quantity: line.quantity, factor,
      points: p?.points, unitPrice: unit, amount: fee === undefined ? undefined : cents(fee * line.quantity),
    }
  })
  const findings = (result.reasons ?? []).filter((r) => !['ELIGIBLE', 'CATALOG_PARTIAL'].includes(r.code))
    .map((r) => ({ code: r.code, rule: r.ruleId ?? r.details?.ruleId, line: r.lineId ?? r.details?.lineId }))
  plans.push({ account: account.id, name: account.name, decision: result.decision, findings, lines, total: cents(lines.reduce((sum, l) => sum + (l.amount ?? 0), 0)) })
}

if (asJson) {
  console.log(JSON.stringify(plans, null, 2))
} else {
  for (const plan of plans) {
    console.log(`\n${plan.name ?? plan.account}  [${plan.account}]`)
    console.log(`  Billing check: ${plan.decision}${plan.findings.length ? ` (${plan.findings.map((f) => `${f.code}${f.line ? ` on ${f.line}` : ''}`).join('; ')})` : ''}`)
    console.log('  GOZ   Tooth  Qty  Points  Single fee  Factor      Amount  Service')
    for (const l of plan.lines) {
      console.log(`  ${l.code}  ${l.tooth.padStart(5)}  ${String(l.quantity).padStart(3)}  ${String(l.points ?? '-').padStart(6)}  ${(l.unitPrice === undefined ? '-' : euro(l.unitPrice)).padStart(10)}  ${String(l.factor).padStart(6)}  ${(l.amount === undefined ? '-' : euro(l.amount)).padStart(10)}  ${l.display}`)
    }
    console.log(`  Total dentist fees (GOZ, without lab costs and materials): ${euro(plan.total)}`)
  }
  console.log('\nGenerated for the hackathon, not a billing-grade calculation.')
}
