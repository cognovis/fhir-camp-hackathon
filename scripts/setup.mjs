#!/usr/bin/env node
// Prepares the local Aidbox for the hackathon, in one go:
//   1. waits for Aidbox,
//   2. installs the public dental FHIR packages,
//   3. loads the GOZ catalog, the practice and the synthetic patients,
//   4. validates every loaded resource that claims a profile against that profile.
//
// Usage: node scripts/setup.mjs [--validate-only]
// Environment (or .env): AIDBOX_URL (default http://localhost:${AIDBOX_PORT:-8080}), AIDBOX_CLIENT / AIDBOX_SECRET
// (default root / hackathon, as set in docker-compose.yml).

import { existsSync, readFileSync, readdirSync } from 'node:fs'

// Read AIDBOX_PORT and the other settings from the repository's .env, as Docker Compose does.
// Variables already set in the environment win.
const envFile = new URL('../.env', import.meta.url)
if (existsSync(envFile)) process.loadEnvFile?.(envFile)

const BASE = (process.env.AIDBOX_URL ?? `http://localhost:${process.env.AIDBOX_PORT ?? '8080'}`).replace(/\/$/, '')
const AUTH = `Basic ${Buffer.from(`${process.env.AIDBOX_CLIENT ?? 'root'}:${process.env.AIDBOX_SECRET ?? 'hackathon'}`).toString('base64')}`
const root = new URL('..', import.meta.url)
const validateOnly = process.argv.includes('--validate-only')

const PACKAGES = [
  {
    name: 'de.cognovis.fhir.dental.core#0.10.2',
    probe: 'https://fhir.cognovis.de/dental-core/StructureDefinition/dental-tooth-state',
    parameters: [{ name: 'package', valueString: 'https://fhir.cognovis.de/dental-core/0.10.2/package.tgz' }],
  },
  {
    name: 'de.cognovis.fhir.dental#0.57.2',
    probe: 'https://fhir.cognovis.de/dental/StructureDefinition/dental-care-plan',
    parameters: [
      { name: 'package', valueString: 'https://fhir.cognovis.de/dental/0.57.2/package.tgz' },
      // Installed in the step before, from its public URL. The default package registry
      // (fs.get-ig.org) does not carry it.
      override('de.cognovis.fhir.dental.core'),
      // Not published yet. Only the GOZ/BEMA ChargeItem and invoice profiles and one Task
      // profile of the dental package need it; see README, "Known gaps".
      override('de.cognovis.fhir.billing'),
      // Not on a public registry. Only the KZBV DPF abbreviation bindings use it.
      override('de.cognovis.terminology.dental.dpf-kuerzel'),
    ],
  },
]

function override(name) {
  return { name: 'override', part: [{ name: 'from', valueString: name }, { name: 'to', valueBoolean: false }] }
}

async function fhir(method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    // An Aidbox that is not activated yet redirects every request to its activation page.
    redirect: 'manual',
    headers: { authorization: AUTH, accept: 'application/fhir+json', ...(body ? { 'content-type': 'application/fhir+json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let json
  try { json = text ? JSON.parse(text) : undefined } catch { json = { raw: text.slice(0, 500) } }
  return { status: response.status, json }
}

function fail(message) {
  console.error(`\nSetup failed: ${message}`)
  process.exit(1)
}

// In the all-in-one Compose stack the setup container waits until Aidbox is activated in the
// browser instead of failing; run on the host, it fails at once with instructions.
const WAIT_FOR_ACTIVATION = process.env.SETUP_WAIT_FOR_ACTIVATION === 'true'
const BROWSER_URL = process.env.AIDBOX_BROWSER_URL ?? BASE

async function waitForAidbox() {
  process.stdout.write(`Waiting for Aidbox at ${BASE} `)
  let activationNotice = 0
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const health = await fetch(`${BASE}/health`, { redirect: 'manual' })
      if (health.status >= 300 && health.status < 400) {
        const message = `Aidbox is not activated yet. Open ${BROWSER_URL} in the browser and log in with your Aidbox account, or set BOX_LICENSE in .env`
        if (!WAIT_FOR_ACTIVATION) fail(`${message} and run docker compose up -d again. Then rerun npm run setup.`)
        // Up to 30 minutes for the activation; repeat the hint every 30 seconds.
        if (activationNotice % 15 === 0) console.log(`\n${message}. Waiting for the activation ...`)
        activationNotice += 1
        if (activationNotice > 900) fail(`${message}, then run docker compose up again.`)
        attempt -= 1
        await new Promise((resolve) => setTimeout(resolve, 2000))
        continue
      }
      if (health.ok) {
        const probe = await fhir('GET', '/fhir/metadata?_summary=true')
        if (probe.status === 200) { console.log(' ready.'); return }
        if (probe.status === 401 || probe.status === 403) {
          fail(`Aidbox answers ${probe.status}. Check AIDBOX_CLIENT/AIDBOX_SECRET.`)
        }
      }
    } catch { /* not up yet */ }
    process.stdout.write('.')
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  fail(`Aidbox did not become ready. Is it running (docker compose ps)? See docker compose logs aidbox.`)
}

async function installed(canonical) {
  const result = await fhir('GET', `/fhir/StructureDefinition?url=${encodeURIComponent(canonical)}&_elements=id&_count=1`)
  return result.status === 200 && (result.json?.entry?.length ?? 0) > 0
}

async function installPackages() {
  for (const pkg of PACKAGES) {
    if (await installed(pkg.probe)) { console.log(`Package ${pkg.name}: already installed.`); continue }
    process.stdout.write(`Package ${pkg.name}: installing ... `)
    const result = await fhir('POST', '/fhir/$fhir-package-install', { resourceType: 'Parameters', parameter: pkg.parameters })
    const ok = result.json?.parameter?.find((p) => p.name === 'result')?.valueBoolean
    if (!ok) fail(`installing ${pkg.name}: ${JSON.stringify(result.json).slice(0, 800)}`)
    const packages = result.json.parameter.filter((p) => p.name === 'package')
      .map((p) => p.part.find((x) => x.name === 'name')?.valueString)
    console.log(`done (${packages.join(', ')}).`)
  }
}

function bundleFiles() {
  const data = readdirSync(new URL('data/', root)).filter((f) => f.endsWith('.json')).sort().map((f) => `data/${f}`)
  return ['catalog/goz-catalog.bundle.json', ...data, 'billing/examples/goz-real-valid.json', 'billing/examples/goz-real-invalid.json', 'billing/examples/goz-real-agreement.json']
}

function seedBundle(file) {
  const bundle = JSON.parse(readFileSync(new URL(file, root), 'utf8'))
  if (!file.startsWith('billing/examples/')) return bundle
  // Standalone examples include Greta; the full Patient is owned by data/, never replaced here.
  const entry = bundle.entry.filter(({ resource }) => !(resource.resourceType === 'Patient' && resource.id === 'dent-051'))
  for (const { resource } of entry) {
    if (!resource.id.startsWith('goz-real-') || !resource.meta?.tag?.some((t) => t.code === 'HTEST')) throw new Error(`Unsafe example seed ${resource.resourceType}/${resource.id}`)
  }
  return { resourceType: 'Bundle', type: 'transaction', entry: entry.map(({ resource }) => ({ resource, request: { method: 'PUT', url: `${resource.resourceType}/${resource.id}` } })) }
}

if (process.argv.includes('--check-seed')) {
  const entries = bundleFiles().flatMap((file) => seedBundle(file).entry)
  const resources = new Map()
  for (const { resource } of entries) {
    const key = `${resource.resourceType}/${resource.id}`
    if (resources.has(key)) throw new Error(`Duplicate seed resource ${key}`)
    resources.set(key, resource)
  }
  function checkReferences(value) {
    if (!value || typeof value !== 'object') return
    if (typeof value.reference === 'string' && /^[A-Z][A-Za-z]+\/[A-Za-z0-9.-]+$/.test(value.reference) && !resources.has(value.reference)) throw new Error(`Missing seed reference ${value.reference}`)
    Object.values(value).forEach(checkReferences)
  }
  resources.forEach(checkReferences)
  const patient = resources.get('Patient/dent-051')
  if (!patient?.birthDate || !patient.identifier?.length) throw new Error('Full Greta seed was replaced by an example')
  console.log(JSON.stringify({ files: bundleFiles(), resources: resources.size, patientPreserved: true, referencesComplete: true }))
  process.exit(0)
}

async function loadBundles() {
  for (const file of bundleFiles()) {
    const bundle = seedBundle(file)
    const result = await fhir('POST', '/fhir', bundle)
    if (result.status >= 300) fail(`loading ${file} (HTTP ${result.status}): ${JSON.stringify(result.json).slice(0, 1500)}`)
    console.log(`Loaded ${file}: ${bundle.entry.length} resources.`)
  }
}

async function validate() {
  let checked = 0
  let baseChecked = 0
  const problems = []
  for (const file of bundleFiles()) {
    const bundle = seedBundle(file)
    for (const { resource } of bundle.entry) {
      const demoEvidence = resource.resourceType === 'Observation' && resource.code?.coding?.some((c) => c.system === 'https://github.com/cognovis/fhir-camp-hackathon/CodeSystem/goz-evidence')
      const demoEncounter = resource.resourceType === 'Encounter' && resource.id.startsWith('dent-051-demo-')
      const baseProfile = file.startsWith('billing/examples/') || resource.resourceType === 'Library' || demoEvidence || demoEncounter
      const profiles = resource.meta?.profile ?? (baseProfile ? [`http://hl7.org/fhir/StructureDefinition/${resource.resourceType}`] : [])
      if (profiles.length === 0) continue
      const stored = await fhir('GET', `/fhir/${resource.resourceType}/${resource.id}`)
      if (stored.status !== 200) { problems.push(`${resource.resourceType}/${resource.id}: not found in Aidbox (HTTP ${stored.status})`); continue }
      for (const profile of profiles) {
        const result = await fhir('POST', `/fhir/${resource.resourceType}/$validate?profile=${encodeURIComponent(profile)}`, stored.json)
        if (baseProfile) baseChecked += 1
        else checked += 1
        const errors = (result.json?.issue ?? []).filter((issue) => issue.severity === 'error' || issue.severity === 'fatal')
        if (result.status >= 300 && errors.length === 0) problems.push(`${resource.resourceType}/${resource.id} against ${profile}: HTTP ${result.status}`)
        for (const issue of errors) problems.push(`${resource.resourceType}/${resource.id} against ${profile}: ${issue.diagnostics ?? issue.details?.text ?? issue.code} (${(issue.expression ?? []).join(', ')})`)
      }
    }
  }
  if (problems.length > 0) {
    console.error(`Validation: ${problems.length} problem(s) in ${checked} profile checks:`)
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }
  console.log(`Validation: ${checked} profile checks passed, 0 errors; ${baseChecked} base-R4 checks passed.`)
}

await waitForAidbox()
if (!validateOnly) {
  await installPackages()
  await loadBundles()
}
await validate()
console.log(`\nDone. Aidbox UI: ${BROWSER_URL} (admin / hackathon). Starter app: ${process.env.APP_BROWSER_URL ?? 'npm run app'}`)
