// Tests for the cost plan generator: the generated Account and ChargeItems for the seeded
// CarePlans of DENT-051 must match the seeded cost plans, apart from their ids.
// Run with `npm --workspace billing test`.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { buildCostPlan, GOZ_SYSTEM } from './charges-from-plan.mjs'

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
const seed = read('../data/dent-051-palmried.json').entry.map((e) => e.resource)
const catalog = read('../catalog/goz-catalog.bundle.json').entry.map((e) => e.resource)
  .filter((r) => r.resourceType === 'ChargeItemDefinition')

const byId = (id) => seed.find((r) => r.id === id)
const resolve = (reference) => seed.find((r) => `${r.resourceType}/${r.id}` === reference)
const definitionFor = (code) => catalog.find((d) => d.code.coding.some((c) => c.system === GOZ_SYSTEM && c.code === code))
const coverage = { reference: 'Coverage/dent-051-cov-01' }
const owner = { reference: 'Organization/fhir-camp-practice' }

const generate = (carePlanId, options = {}) => buildCostPlan({
  carePlan: byId(carePlanId), definitionFor, resolve, coverage, owner, ...options,
})

// The seeded resources, with the ids and the account reference taken out.
const comparable = (resource) => {
  const { id, account, ...rest } = resource
  return rest
}

describe('buildCostPlan for the seeded alternatives of DENT-051', () => {
  for (const [alt, factors] of [['a', {}], ['b', {}], ['c', { 9010: 3 }]]) {
    it(`reproduces the seeded ChargeItems of CarePlan/dent-051-hkp-alt-${alt}`, () => {
      const { account, chargeItems } = generate(`dent-051-hkp-alt-${alt}`, { factors })
      const seeded = seed.filter((r) => r.resourceType === 'ChargeItem' && r.id.startsWith(`dent-051-alt-${alt}-`))
      assert.equal(chargeItems.length, seeded.length)
      assert.deepEqual(chargeItems.map(comparable), seeded.map(comparable))
      for (const item of chargeItems) assert.deepEqual(item.account, [{ reference: `Account/${account.id}` }])
    })

    it(`reproduces the seeded Account of CarePlan/dent-051-hkp-alt-${alt}`, () => {
      const { account } = generate(`dent-051-hkp-alt-${alt}`, { factors })
      assert.deepEqual(comparable(account), comparable(byId(`dent-051-cost-plan-${alt}`)))
    })
  }

  it('derives stable ids from the CarePlan id', () => {
    const { account, chargeItems } = generate('dent-051-hkp-alt-a')
    assert.equal(account.id, 'dent-051-hkp-alt-a-cost-plan')
    assert.deepEqual(chargeItems.map((c) => c.id).slice(0, 2), ['dent-051-hkp-alt-a-charge-01', 'dent-051-hkp-alt-a-charge-02'])
  })

  it('uses 2.3 as the default multiplier', () => {
    const { chargeItems } = generate('dent-051-hkp-alt-c')
    assert.ok(chargeItems.every((c) => c.factorOverride === 2.3))
  })
})

describe('buildCostPlan refuses what it cannot price', () => {
  const withActivity = (detail) => {
    const carePlan = structuredClone(byId('dent-051-hkp-alt-b'))
    carePlan.activity.push({ detail: { kind: 'ServiceRequest', status: 'not-started', ...detail } })
    return carePlan
  }

  it('refuses a GOZ number that is not in the catalog', () => {
    const carePlan = withActivity({ code: { coding: [{ system: GOZ_SYSTEM, code: '9999' }] } })
    assert.throws(() => buildCostPlan({ carePlan, definitionFor, resolve, coverage, owner }), /GOZ 9999.*not in the catalog/)
  })

  it('refuses an activity without a GOZ coding', () => {
    const carePlan = withActivity({ code: { coding: [{ system: 'http://snomed.info/sct', code: '123' }] } })
    assert.throws(() => buildCostPlan({ carePlan, definitionFor, resolve, coverage, owner }), /no GOZ number/)
  })

  it('refuses a reasonReference that cannot be resolved to a tooth', () => {
    const carePlan = withActivity({
      code: { coding: [{ system: GOZ_SYSTEM, code: '0090' }] },
      reasonReference: [{ reference: 'Observation/does-not-exist' }],
    })
    assert.throws(() => buildCostPlan({ carePlan, definitionFor, resolve, coverage, owner }), /Observation\/does-not-exist/)
  })

  it('refuses a factor for a GOZ number the plan does not contain', () => {
    assert.throws(() => generate('dent-051-hkp-alt-a', { factors: { 9010: 3 } }), /9010.*not in CarePlan/)
  })

  it('refuses a CarePlan without a subject', () => {
    const carePlan = structuredClone(byId('dent-051-hkp-alt-a'))
    delete carePlan.subject
    assert.throws(() => buildCostPlan({ carePlan, definitionFor, resolve, coverage, owner }), /subject/)
  })
})

describe('buildCostPlan for a CarePlan shaped like a new alternative', () => {
  it('takes the display from the catalog when the activity has none, and the activity quantity', () => {
    const carePlan = {
      resourceType: 'CarePlan', id: 'new-alt', status: 'draft', intent: 'option',
      title: 'HKP Alternative D: Modellgussprothese', subject: { reference: 'Patient/dent-051' },
      period: { start: '2026-12-01' },
      activity: [{
        detail: {
          kind: 'ServiceRequest', status: 'not-started', quantity: { value: 2 },
          code: { coding: [{ system: GOZ_SYSTEM, code: '0090' }] },
          reasonReference: [{ reference: 'Observation/dent-051-obs-tooth-chart-36' }],
        },
      }],
    }
    const { account, chargeItems } = buildCostPlan({ carePlan, definitionFor, resolve, coverage, owner })
    assert.equal(account.name, 'Kostenplan Alternative D: Modellgussprothese')
    assert.equal(account.servicePeriod.start, '2026-12-01')
    assert.equal(account.type, undefined)
    const [item] = chargeItems
    assert.equal(item.code.coding[0].display, definitionFor('0090').code.coding[0].display)
    assert.deepEqual(item.quantity, { value: 2 })
    assert.deepEqual(item.bodysite[0].coding, [{ system: 'https://fhir.cognovis.de/dental-core/CodeSystem/tooth-position-fdi', code: '36' }])
    assert.equal(item.occurrenceDateTime, '2026-12-01')
  })
})
