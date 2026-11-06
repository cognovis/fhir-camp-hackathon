#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { loadCatalog, loadCases, evaluateGozAccount } from './evaluate-goz.mjs'
const env = new URL('../.env', import.meta.url)
if (existsSync(env)) process.loadEnvFile?.(env)
const args = process.argv.slice(2)
const option = (name) => { const i = args.indexOf(name); if (i >= 0 && (!args[i + 1] || args[i + 1].startsWith('--'))) throw new Error(`Missing ${name} value`); return i < 0 ? undefined : args[i + 1] }
const catalog = loadCatalog(), cases = await loadCases({ bundlePath: option('--bundle'), patientId: option('--aidbox') })
for (const { resource } of cases.entry.filter((e) => e.resource.resourceType === 'Account')) {
  const result = await evaluateGozAccount({ catalog, cases, account: resource.id, asOf: option('--as-of') })
  const { prices, case: evaluatedCase, ...report } = result
  console.log(JSON.stringify(report))
}
