import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const ruleId = 'goz-5120-requires-5000-or-5010'
const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
// Exercise the existing CLI's evaluateBillingAccount path and its per-Account projection.
const evaluate = (...args) => JSON.parse(execFileSync(process.execPath,
  [new URL('cost-plan.mjs', import.meta.url).pathname, '--json', ...args], { encoding: 'utf8' }))

test('generated Library contains the source rule and is linked by the edition', () => {
  const resources = read('../catalog/goz-catalog.bundle.json').entry.map((e) => e.resource)
  const library = resources.find((r) => r.id === 'goz-hackathon-rules')
  const payload = JSON.parse(Buffer.from(library.content[0].data, 'base64').toString('utf8'))
  const rule = payload.rules.find((r) => r.id === ruleId)
  assert.deepEqual(rule, read('goz-hackathon-rules.json').rules.find((r) => r.id === ruleId))
  assert.equal(rule.class, 'companion-required')
  assert.deepEqual(rule.parameters.required.codes, ['5000', '5010'])
  assert.equal(rule.parameters.countingScope, undefined)
  assert.equal(rule.provenance.evidenceLevel.code, 'invented')
  assert.ok(resources.find((r) => r.id === 'goz-hackathon-edition').relatedArtifact
    .some((r) => r.type === 'composed-of' && r.resource === `${library.url}|${library.version}`))
})

test('companions are alternatives within one Account, never across Accounts', () => {
  const fixture = read('examples/companion-cost-plans.json')
  for (const resource of [fixture, ...fixture.entry.map((e) => e.resource)]) {
    assert.ok(resource.meta.tag.some((t) => t.code === 'HTEST'))
  }
  const plans = evaluate('--bundle', new URL('examples/companion-cost-plans.json', import.meta.url).pathname)
  assert.equal(plans.length, 6)
  for (const name of ['5000', '5010', 'no-5120', 'donor', 'missing', 'other-account']) {
    const plan = plans.find((p) => p.account === `example-companion-${name}`)
    const blocked = ['missing', 'other-account'].includes(name)
    assert.equal(plan.decision, blocked ? 'block' : 'allow', name)
    assert.deepEqual(plan.findings, blocked
      ? [{ code: 'COMPANION_CODE_REQUIRED', rule: ruleId, line: `${plan.account}-5120` }]
      : [], name)
  }
})

test('existing alternatives keep their decisions and prices', () => {
  assert.deepEqual(evaluate().map((p) => [p.account, p.decision, p.total]), [
    ['dent-051-cost-plan-a', 'allow', 549.26],
    ['dent-051-cost-plan-b', 'allow', 428.44],
    ['dent-051-cost-plan-c', 'unavailable', 673.59],
  ])
})
