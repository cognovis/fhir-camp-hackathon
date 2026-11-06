import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test, { beforeEach } from 'node:test'
import { i18n } from '../src/i18n.ts'
import { euro, findingText, findingExplanation, RULE_EXPLANATIONS } from '../src/costPlan.ts'
import { createPlan } from '../src/plans.ts'
import { chooseAlternative } from '../src/planAlternatives.ts'
import { updateAll } from '../src/fhir.ts'

const resources = JSON.parse(readFileSync(new URL('../../data/dent-051-palmried.json', import.meta.url), 'utf8')).entry.map(({ resource }) => resource)
const patient = resources.find((r) => r.resourceType === 'Patient')
const source = resources.find((r) => r.id === 'dent-051-hkp-alt-c')
const plans = resources.filter((r) => r.resourceType === 'CarePlan')
const charges = resources.filter((r) => r.resourceType === 'ChargeItem')
const account = resources.find((r) => r.id === 'dent-051-cost-plan-c')

beforeEach(async () => { await i18n.changeLanguage('de-DE') })

test('choosing an alternative changes only draft intents and keeps services', () => {
  const completed = { ...plans[0], id: 'completed', status: 'completed' }
  const changed = chooseAlternative([...plans, completed], source.id)
  assert.equal(changed.filter((p) => p.intent === 'plan').length, 1)
  assert.equal(changed.find((p) => p.intent === 'plan')?.id, source.id)
  assert.ok(changed.every((p) => p.status === 'draft'))
  for (const plan of changed) assert.deepEqual(plan.activity, plans.find((p) => p.id === plan.id).activity)
  assert.equal(completed.status, 'completed')
  assert.throws(() => chooseAlternative(plans, 'unknown'))
  assert.throws(() => chooseAlternative([completed], completed.id))
})

test('choice writes all alternatives atomically with their read versions', async (t) => {
  const versioned = plans.map((p, i) => ({ ...p, meta: { ...p.meta, versionId: String(i + 1) } }))
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    assert.equal(url, '/fhir')
    const body = JSON.parse(String(init.body))
    assert.equal(body.type, 'transaction')
    assert.equal(body.entry.length, versioned.length)
    body.entry.forEach((entry, i) => {
      assert.equal(entry.request.ifMatch, `W/"${i + 1}"`)
      assert.equal(entry.request.method, 'PUT')
    })
    return Response.json({ resourceType: 'OperationOutcome' }, { status: 412 })
  })
  await assert.rejects(updateAll(chooseAlternative(versioned, source.id)), /412/)
})

test('missing fees stay unavailable, while zero is a real price', () => {
  assert.equal(euro(null), '–')
  assert.equal(euro(undefined), '–')
  assert.match(euro(0), /0,00/)
  assert.match(euro(549.26), /549,26/)
})

test('contextual billing explanations reach the view', () => {
  const message = findingText({ code: 'GOZ_JUSTIFICATION_REQUIRED', rule: 'GOZ-G02' }, { id: 'insertion', code: '9010', tooth: '36', display: '', quantity: 1, factor: 3 })
  assert.match(message, /GOZ 9010 · Zahn 36/)
  assert.match(message, /schriftliche Begründung/)
})

test('missing evidence is distinguished from a demonstrated rule violation', () => {
  const missing = findingExplanation({ code: 'REQUIRED_FACT_UNAVAILABLE', rule: 'goz-9040-implantSystem', effect: 'needs-review', details: { fact: 'system|implantSystem' } })
  assert.equal(missing.kind, 'Prüfbedarf')
  assert.match(missing.summary, /Implantatsystem/)
  assert.match(missing.rule, /zweiphasiges/)
  const invalid = findingExplanation({ code: 'ACCOMPANYING_INFORMATION_REQUIRED', rule: 'goz-9040-implantSystem', effect: 'reject' })
  assert.equal(invalid.kind, 'Regelverstoß')
  assert.match(invalid.summary, /erfüllt.*nicht/)
})

test('every installed rule has an explanation, and unknown findings stay visible', () => {
  const root = new URL('../../billing/', import.meta.url)
  const rules = ['goz-context-rules.json', 'goz-hackathon-rules.json'].flatMap((file) => JSON.parse(readFileSync(new URL(file, root), 'utf8')).rules)
  for (const rule of rules) assert.ok(RULE_EXPLANATIONS[rule.id], rule.id)
  assert.match(findingText({ code: 'FUTURE_UNKNOWN_FINDING' }), /Angaben/)
})

test('a copied plan keeps its source Account coverage and factors', async (t) => {
  const writes: { url: string; body: any }[] = []
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    const path = String(url)
    if (!init.method || init.method === 'GET') {
      assert.equal(path, '/fhir/Account/dent-051-cost-plan-c')
      return Response.json(account)
    }
    const body = JSON.parse(String(init.body))
    writes.push({ url: path, body })
    if (path === '/fhir/CarePlan/$validate') return Response.json({ resourceType: 'OperationOutcome', issue: [] })
    if (path.startsWith('/fhir/CarePlan/')) return Response.json(body)
    assert.equal(path, '/api/charges-from-plan')
    return Response.json({ message: 'created' })
  })
  const saved = await createPlan(patient, plans, charges, source)
  assert.equal(saved.id, 'dent-051-hkp-alt-d')
  const request = writes.find((w) => w.url === '/api/charges-from-plan')!.body
  assert.equal(request.coverage, 'dent-051-cov-01')
  assert.equal(request.factors['9010'], 3)
})

test('ambiguous source coverage is rejected before creating a partial plan', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url, init = {}) => {
    assert.ok(!init.method || init.method === 'GET', 'must not write')
    return Response.json({ ...account, coverage: [...account.coverage, ...account.coverage] })
  })
  await assert.rejects(createPlan(patient, plans, charges, source), /eindeutig zugeordnete Versicherung/)
})

test('a source Account belonging to another patient is rejected before writes', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url, init = {}) => {
    assert.ok(!init.method || init.method === 'GET', 'must not write')
    return Response.json({ ...account, subject: [{ reference: 'Patient/another' }] })
  })
  await assert.rejects(createPlan(patient, plans, charges, source), /gehört nicht/)
})
