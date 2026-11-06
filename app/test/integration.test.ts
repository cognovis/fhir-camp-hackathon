import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { euro, findingText } from '../src/costPlan.ts'
import { createPlan } from '../src/plans.ts'

const resources = JSON.parse(readFileSync(new URL('../../data/dent-051-palmried.json', import.meta.url), 'utf8')).entry.map(({ resource }) => resource)
const patient = resources.find((r) => r.resourceType === 'Patient')
const source = resources.find((r) => r.id === 'dent-051-hkp-alt-c')
const plans = resources.filter((r) => r.resourceType === 'CarePlan')
const charges = resources.filter((r) => r.resourceType === 'ChargeItem')
const account = resources.find((r) => r.id === 'dent-051-cost-plan-c')

test('missing fees stay unavailable, while zero is a real price', () => {
  assert.equal(euro(null), '–')
  assert.equal(euro(undefined), '–')
  assert.match(euro(0), /0,00/)
  assert.match(euro(549.26), /549,26/)
})

test('contextual billing explanations reach the view', () => {
  assert.equal(findingText({ code: 'GOZ_JUSTIFICATION_REQUIRED', message: 'Individual evidence required.' }), 'Individual evidence required.')
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
  await assert.rejects(createPlan(patient, plans, charges, source), /unambiguous Coverage/)
})

test('a source Account belonging to another patient is rejected before writes', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url, init = {}) => {
    assert.ok(!init.method || init.method === 'GET', 'must not write')
    return Response.json({ ...account, subject: [{ reference: 'Patient/another' }] })
  })
  await assert.rejects(createPlan(patient, plans, charges, source), /does not belong/)
})
