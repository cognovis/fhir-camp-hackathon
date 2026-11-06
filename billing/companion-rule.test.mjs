import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { evaluateGozAccount, loadCases } from './evaluate-goz.mjs'
import { CONTEXT_URL, readContextLibrary, unitFeeCents } from './goz-context.mjs'

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)))
const catalog = read('../catalog/goz-catalog.bundle.json')
const system = readContextLibrary(catalog).payload.factSystem
const reference = read('examples/goz-real-valid.json')
const resources = (b) => b.entry.map((e) => e.resource)
const charge = (b, code) => resources(b).find((r) => r.resourceType === 'ChargeItem' && r.code.coding[0].code === code)
const subset = (...codes) => { const b = structuredClone(reference); b.entry = b.entry.filter((e) => e.resource.resourceType !== 'ChargeItem' || codes.includes(e.resource.code.coding[0].code)); return b }
let sequence = 0
function setFact(b, line, key, value) {
  const previous = resources(b).find((r) => line.supportingInformation?.some((s) => s.reference === `Observation/${r.id}`) && r.code?.coding?.some((c) => c.system === system && c.code === key))
  line.supportingInformation = line.supportingInformation.filter((s) => s.reference !== `Observation/${previous?.id}`)
  if (value === undefined) return
  const r = { resourceType: 'Observation', id: `goz-real-test-${++sequence}`, meta: reference.meta, status: 'final', code: { coding: [{ system, code: key }] }, subject: line.subject, effectiveDateTime: '2026-11-16T08:00:00+01:00', performer: [{ display: 'Synthetic test author' }] }
  if (typeof value === 'boolean') r.valueBoolean = value
  else if (Array.isArray(value)) { r.valueString = 'Identified billing units (see components)'; r.component = value.map((id) => ({ code: { coding: [{ system, code: 'unitId' }] }, valueString: id })) }
  else r.valueString = String(value)
  b.entry.push({ resource: r }); line.supportingInformation.push({ reference: `Observation/${r.id}` })
}
function copyLine(b, line, id, code = line.code.coding[0].code) {
  const other = structuredClone(line); other.id = id; other.code.coding[0].code = code
  b.entry.push({ resource: other }); return other
}
function setSession(b, line, id) {
  b.entry.push({ resource: { resourceType: 'Encounter', id, meta: reference.meta, status: 'planned', class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' }, subject: line.subject } })
  line.context = { reference: `Encounter/${id}` }; setFact(b, line, 'sessionId', `Encounter/${id}`)
}
const evaluate = (b, c = catalog) => evaluateGozAccount({ catalog: c, cases: b, account: resources(b).find((r) => r.resourceType === 'Account').id })
const has = (r, id, code, line) => r.findings.some((f) => f.rule === id && (!code || f.code === code) && (!line || f.line === line))

test('real rules replace the invented payload; both Libraries decode and remain bound', () => {
  const native = read('goz-hackathon-rules.json')
  assert.equal(native.rules.length, 2)
  assert.ok(native.rules.every((r) => r.provenance.evidenceLevel.code !== 'invented'))
  assert.ok(!native.rules.some((r) => r.id.includes('once-per-cost-plan') || r.id.includes('requires-5000')))
  assert.deepEqual(readContextLibrary(catalog).payload, read('goz-context-rules.json'))
})
test('complete synthetic inputs cover every selected service; invalid 5010 keeps exact native finding', async () => {
  assert.equal((await evaluate(reference)).decision, 'allow')
  const result = await evaluate(read('examples/goz-real-invalid.json'))
  assert.equal(result.decision, 'block')
  assert.ok(has(result, 'goz-5010-supportKind', 'ACCOMPANYING_INFORMATION_REQUIRED', 'goz-real-invalid-5010'))
  for (const r of [reference, ...resources(reference)]) assert.ok(r.meta.tag.some((t) => t.code === 'HTEST'))
})
test('0030/0040 exclude each other only for the same planning subject', async () => {
  const b = subset('0030'), line = charge(b, '0030'), other = copyLine(b, line, 'goz-real-0040', '0040')
  assert.ok(has(await evaluate(b), 'GOZ-0030-exclusion', 'GOZ_EXCLUDED_SERVICE', line.id))
  setFact(b, other, 'planningObjectId', 'a-different-plan')
  assert.equal((await evaluate(b)).decision, 'allow')
})
test('0090 counts split lines per tooth/session and accepts an individual repeat reason', async () => {
  const b = subset('0090'), first = charge(b, '0090'), other = copyLine(b, first, 'goz-real-0090-repeat')
  const missing = await evaluate(b)
  assert.equal(missing.decision, 'unavailable'); assert.ok(has(missing, 'GOZ-0090-repeat'))
  for (const line of [first, other]) { setFact(b, line, 'repeatJustificationConfirmed', true); setFact(b, line, 'repeatJustification', 'Additional injection after insufficient anaesthesia (synthetic)') }
  assert.equal((await evaluate(b)).decision, 'allow')
  setFact(b, first, 'repeatJustification', undefined); setFact(b, other, 'repeatJustification', undefined)
  setFact(b, other, 'targetId', 'another-tooth')
  assert.equal((await evaluate(b)).decision, 'allow')
  setFact(b, other, 'targetId', 'tooth-35'); setSession(b, other, 'goz-real-second-session')
  assert.equal((await evaluate(b)).decision, 'allow')
})
test('an unplaced line or unconfirmed scope cannot be silently excluded', async () => {
  const b = subset('0090'), first = charge(b, '0090'), other = copyLine(b, first, 'goz-real-unplaced')
  setFact(b, other, 'targetId', undefined)
  assert.ok(has(await evaluate(b), 'GOZ-0090-repeat', 'GOZ_SCOPE_AMBIGUOUS'))
  setFact(b, first, 'scopeComplete', false)
  assert.ok(has(await evaluate(b), 'GOZ-0090-repeat', 'GOZ_HISTORY_INCOMPLETE'))
})
test('2200 excludes a filling in the same restoration context, not on another tooth', async () => {
  const b = subset('2200'), line = charge(b, '2200'), other = copyLine(b, line, 'goz-real-filling', '2050')
  assert.ok(has(await evaluate(b), 'GOZ-2200-exclusion', 'GOZ_EXCLUDED_SERVICE'))
  setFact(b, other, 'targetId', 'another-tooth')
  assert.equal((await evaluate(b)).decision, 'allow')
})
test('a linked included component is not charged again; independent service is allowed', async () => {
  for (const code of ['2200', '5000', '5010', '9010']) {
    const b = subset(code), parent = charge(b, code), child = copyLine(b, parent, `goz-real-component-${code}`, '2310')
    setFact(b, child, 'includedIn', `ChargeItem/${parent.id}`)
    setFact(b, child, 'component', code === '9010' ? 'primary-wound-care' : 'preparation')
    assert.ok((await evaluate(b)).findings.some((f) => f.code === 'GOZ_COMPONENT_ALREADY_INCLUDED' && f.line === child.id))
    setFact(b, child, 'includedIn', undefined)
    assert.equal((await evaluate(b)).decision, 'allow')
  }
})
test('each billed unit is identified and split duplicate lines are counted', async () => {
  for (const code of ['2200', '5000', '5010', '5070', '5120', '5140', '9000', '9003', '9010']) {
    const b = subset(code), first = charge(b, code), second = copyLine(b, first, `goz-real-duplicate-${code}`)
    assert.ok((await evaluate(b)).findings.some((f) => f.code === 'GOZ_UNIT_QUANTITY_MISMATCH' && f.line === first.id), code)
    setFact(b, second, 'unitIds', [`another-unit-${code}`])
    assert.equal((await evaluate(b)).decision, 'allow', code)
  }
})
test('5000 and 5010 cannot charge the same anchor twice', async () => {
  const b = subset('5000'), first = charge(b, '5000'), second = copyLine(b, first, 'goz-real-same-anchor', '5010')
  assert.ok(has(await evaluate(b), 'GOZ-anchor-units', 'GOZ_UNIT_QUANTITY_MISMATCH'))
  setFact(b, second, 'unitIds', ['another-anchor'])
  assert.equal((await evaluate(b)).decision, 'allow')
})
test('provisional reinsertion is included, but new manufacture after loss is distinct', async () => {
  for (const code of ['5120', '5140']) {
    const b = subset(code), line = charge(b, code)
    setFact(b, line, 'provisionalAction', 'reinsertion'); setFact(b, line, 'priorProvisionalBilled', true)
    assert.ok(has(await evaluate(b), 'GOZ-provisional', 'GOZ_PROVISIONAL_ALREADY_INCLUDED'))
    setFact(b, line, 'provisionalAction', 'replacement-after-loss')
    assert.equal((await evaluate(b)).decision, 'allow')
    setFact(b, line, 'provisionalOrigin', 'other-provider')
    assert.ok(has(await evaluate(b), 'GOZ-provisional', 'GOZ_PROVISIONAL_ANALOG_REVIEW'))
  }
})
test('required clinical content and native implant type are checked', async () => {
  for (const [code, key, rule] of [['9000', 'implantAnalysisConfirmed', 'GOZ-9000-content'], ['9003', 'orientationTemplateUsed', 'GOZ-9003-content'], ['9040', 'implantExposureConfirmed', 'GOZ-9040-content']]) {
    const b = subset(code), line = charge(b, code); setFact(b, line, key, false)
    assert.equal((await evaluate(b)).decision, 'unavailable'); assert.ok(has(await evaluate(b), rule))
    line.status = 'billed'; assert.equal((await evaluate(b)).decision, 'block')
  }
  const b = subset('9040'); setFact(b, charge(b, '9040'), 'implantSystem', 'one-phase')
  assert.ok(has(await evaluate(b), 'goz-9040-implantSystem', 'ACCOMPANYING_INFORMATION_REQUIRED'))
})
function implantCase() {
  const b = subset('9010'), line = charge(b, '9010'); line.code.coding[0].code = '9050'
  setFact(b, line, 'implantSystem', 'two-phase'); setFact(b, line, 'phase', 'reconstructive'); setFact(b, line, 'phaseId', 'reconstruction-1')
  return [b, line]
}
test('9050 uses implant/session and phase limits, including billed history', async () => {
  const [b, line] = implantCase(); assert.equal((await evaluate(b)).decision, 'allow')
  const other = copyLine(b, line, 'goz-real-implant-conflict', '9040')
  setFact(b, other, 'implantExposureConfirmed', true); setFact(b, other, 'abutmentInsertionConfirmed', true)
  assert.ok(has(await evaluate(b), 'GOZ-9050-context', 'GOZ_IMPLANT_EXCLUSION'))
  setFact(b, other, 'implantId', 'different-implant'); assert.ok(!has(await evaluate(b), 'GOZ-9050-context', 'GOZ_IMPLANT_EXCLUSION'))
  b.entry = b.entry.filter((e) => e.resource.id !== other.id)
  for (let i = 1; i <= 3; i += 1) {
    const history = copyLine(b, line, `goz-real-history-${i}`); history.status = 'billed'
    history.account = [{ reference: 'Account/goz-real-other-account' }]; setSession(b, history, `goz-real-history-session-${i}`)
  }
  b.entry.push({ resource: { ...resources(b).find((r) => r.resourceType === 'Account'), id: 'goz-real-other-account' } })
  assert.ok(has(await evaluate(b), 'GOZ-9050-context', 'GOZ_IMPLANT_PHASE_LIMIT'))
  setFact(b, line, 'historyComplete', false); assert.ok(has(await evaluate(b), 'GOZ-9050-context', 'GOZ_HISTORY_INCOMPLETE'))
})
test('a parallel planned alternative is never counted as billed history', async () => {
  const [b, line] = implantCase(); const other = copyLine(b, line, 'goz-real-alternative')
  other.account = [{ reference: 'Account/goz-real-alternative' }]
  b.entry.push({ resource: { ...resources(b).find((r) => r.resourceType === 'Account'), id: 'goz-real-alternative' } })
  other.quantity.value = 4
  assert.equal((await evaluate(b)).decision, 'allow')
})
test('§2 agreement is per position and must precede the service; arbitrary text is insufficient', async () => {
  const b = subset('0030'), line = charge(b, '0030'); line.factorOverride = 4
  assert.ok(has(await evaluate(b), 'GOZ-G01', 'GOZ_FEE_OUTSIDE_RANGE'))
  b.entry.push({ resource: { resourceType: 'DocumentReference', id: 'goz-real-agreement', meta: reference.meta, status: 'current', subject: line.subject, content: [{ attachment: { contentType: 'text/plain', data: Buffer.from('Synthetic written agreement').toString('base64') } }] } })
  for (const [key, value] of Object.entries({ agreementStatus: 'valid', agreementConfirmed: true, agreementDocument: 'DocumentReference/goz-real-agreement', agreementSignedAt: '2026-11-15T09:00:00+01:00', agreementFactor: 4, agreementFee: 44.99, ordinaryExceedsStandard: false })) setFact(b, line, key, value)
  assert.equal((await evaluate(b)).decision, 'allow')
  setFact(b, line, 'agreementSignedAt', '2026-11-17T09:00:00+01:00')
  assert.ok(has(await evaluate(b), 'GOZ-G01', 'GOZ_AGREEMENT_MISMATCH'))
  setFact(b, line, 'agreementSignedAt', '2026-11-16'); assert.ok(has(await evaluate(b), 'GOZ-G01', 'GOZ_AGREEMENT_TIMING_UNKNOWN'))
})
test('above 2.3 requires confirmed individual justification; fee arithmetic rounds once', async () => {
  const b = subset('0030'), line = charge(b, '0030'); line.factorOverride = 3
  assert.equal((await evaluate(b)).decision, 'unavailable')
  setFact(b, line, 'justificationConfirmed', true); line.reason = [{ text: 'Specific increased time (synthetic)' }]
  assert.equal((await evaluate(b)).decision, 'allow')
  setFact(b, line, 'claimedUnitFee', 1); assert.ok(has(await evaluate(b), 'GOZ-G03', 'GOZ_PRICE_MISMATCH'))
  assert.equal(unitFeeCents(1, 0.005, 1), 1)
  assert.equal(unitFeeCents(200, 0.0562421, 2.3), 2587)
})
test('clinical evidence is explicit; contradictions and missing facts stay unavailable', async () => {
  const b = subset('0030'), line = charge(b, '0030')
  setFact(b, line, 'indication', 'not-necessary'); assert.ok(has(await evaluate(b), 'GOZ-G04', 'GOZ_SERVICE_NOT_ELIGIBLE'))
  setFact(b, line, 'indication', undefined); assert.equal((await evaluate(b)).decision, 'unavailable')
})
test('missing, changed, duplicate or wrongly bound contextual Library cannot yield allow', async () => {
  for (const mutate of [
    (c) => { c.entry = c.entry.filter((e) => e.resource.url !== CONTEXT_URL) },
    (c) => { c.entry.push(structuredClone(c.entry.find((e) => e.resource.url === CONTEXT_URL))) },
    (c) => { c.entry.find((e) => e.resource.url === CONTEXT_URL).resource.content[0].data = Buffer.from('{}').toString('base64') },
    (c) => { c.entry.find((e) => e.resource.url === CONTEXT_URL).resource.extension[0].valueString = 'wrong' },
    (c) => { c.entry.find((e) => e.resource.url === CONTEXT_URL).resource.identifier = [] },
    (c) => { c.entry.find((e) => e.resource.url === CONTEXT_URL).resource.type.coding[0].code = 'asset-collection' },
  ]) { const c = structuredClone(catalog); mutate(c); const r = await evaluate(reference, c); assert.equal(r.decision, 'unavailable'); assert.ok(r.findings.some((f) => f.code === 'GOZ_LIBRARY_UNAVAILABLE')) }
  assert.equal((await evaluateGozAccount({ catalog, cases: reference, account: 'goz-real-plan', asOf: '2030-01-01' })).decision, 'unavailable')
})
test('original A/B/C keep prices and now report missing clinical evidence', () => {
  const output = JSON.parse(execFileSync(process.execPath, [new URL('cost-plan.mjs', import.meta.url).pathname, '--json'], { encoding: 'utf8' }))
  assert.deepEqual(output.map((p) => [p.decision, p.total]), [['unavailable', 549.26], ['unavailable', 428.44], ['unavailable', 673.59]])
})
test('Aidbox reads all pages and refuses incomplete searches', async () => {
  const originalFetch = globalThis.fetch, previous = process.env.AIDBOX_URL
  process.env.AIDBOX_URL = 'http://localhost:8081'
  const calls = []
  globalThis.fetch = async (url) => {
    const u = new URL(url); calls.push(u.href)
    let body
    if (u.pathname.endsWith('/Account')) body = { resourceType: 'Bundle', type: 'searchset', total: 2, entry: [{ resource: { resourceType: 'Account', id: u.searchParams.has('page') ? 'b' : 'a' } }], ...(u.searchParams.has('page') ? {} : { link: [{ relation: 'next', url: 'http://localhost:8081/fhir/Account?page=2' }] }) }
    else if (u.pathname.includes('/Patient/')) body = { resourceType: 'Patient', id: 'dent-051' }
    else body = { resourceType: 'Bundle', type: 'searchset', total: 0, entry: [] }
    return new Response(JSON.stringify(body), { status: 200 })
  }
  try {
    assert.equal(resources(await loadCases({ patientId: 'dent-051' })).filter((r) => r.resourceType === 'Account').length, 2)
    assert.ok(calls.some((c) => c.includes('page=2')))
    globalThis.fetch = async () => new Response(JSON.stringify({ resourceType: 'Bundle', type: 'searchset', total: 2, entry: [] }), { status: 200 })
    await assert.rejects(loadCases({ patientId: 'dent-051' }), /Incomplete/)
  } finally { globalThis.fetch = originalFetch; if (previous === undefined) delete process.env.AIDBOX_URL; else process.env.AIDBOX_URL = previous }
})

test('conflicting evidence, missing native support and multiple Account membership never allow', async () => {
  const b = subset('5010'), line = charge(b, '5010')
  setFact(b, line, 'supportKind', undefined)
  assert.equal((await evaluate(b)).decision, 'unavailable')
  setFact(b, line, 'supportKind', 'natural-tooth')
  const assertion = structuredClone(resources(b).find((r) => r.resourceType === 'Observation' && r.id.startsWith('goz-real-test-') && r.code.coding[0].code === 'supportKind'))
  assertion.id = 'goz-real-conflicting-support'; assertion.valueString = 'implant'
  b.entry.push({ resource: assertion }); line.supportingInformation.push({ reference: `Observation/${assertion.id}` })
  assert.notEqual((await evaluate(b)).decision, 'allow')
  const c = subset('0030'); charge(c, '0030').account.push({ reference: 'Account/another' })
  assert.notEqual((await evaluate(c)).decision, 'allow')
})
test('unknown operators and forged parameters fail before any context rule is run', async () => {
  const c = structuredClone(catalog), library = resources(c).find((r) => r.url === CONTEXT_URL)
  const payload = JSON.parse(Buffer.from(library.content[0].data, 'base64'))
  payload.rules[0].operation = 'javascript-eval'
  library.content[0].data = Buffer.from(JSON.stringify(payload)).toString('base64')
  const result = await evaluate(reference, c)
  assert.equal(result.decision, 'unavailable')
  assert.ok(result.findings.some((f) => f.code === 'GOZ_LIBRARY_UNAVAILABLE'))
})
test('a per-position agreement cannot excuse another position and requested justification remains required', async () => {
  const b = subset('0030'), first = charge(b, '0030'), second = copyLine(b, first, 'goz-real-another-plan')
  first.factorOverride = 4; second.factorOverride = 4
  b.entry.push({ resource: { resourceType: 'DocumentReference', id: 'goz-real-valid-agreement', meta: reference.meta, status: 'current', subject: first.subject, content: [{ attachment: { contentType: 'text/plain', data: Buffer.from('Synthetic agreement').toString('base64') } }] } })
  for (const [key, value] of Object.entries({ agreementStatus: 'valid', agreementConfirmed: true, agreementDocument: 'DocumentReference/goz-real-valid-agreement', agreementSignedAt: '2026-11-15T09:00:00+01:00', agreementFactor: 4, agreementFee: 44.99, ordinaryExceedsStandard: true, justificationRequested: true })) setFact(b, first, key, value)
  const result = await evaluate(b)
  assert.ok(has(result, 'GOZ-G01', 'GOZ_FEE_OUTSIDE_RANGE', second.id))
  assert.ok(has(result, 'GOZ-G02', 'GOZ_EVIDENCE_REQUIRED', first.id))
})

test('setup seed includes all runnable GOZ examples with complete references and distinct IDs', () => {
  const output = JSON.parse(execFileSync(process.execPath, [new URL('../scripts/setup.mjs', import.meta.url).pathname, '--check-seed'], { encoding: 'utf8' }))
  for (const name of ['valid', 'invalid', 'agreement']) assert.ok(output.files.includes(`billing/examples/goz-real-${name}.json`))
  assert.equal(output.patientPreserved, true)
  assert.equal(output.referencesComplete, true)
})
test('the seeded individual-agreement example is allowed above the statutory range', async () => {
  assert.equal((await evaluate(read('examples/goz-real-agreement.json'))).decision, 'allow')
})
