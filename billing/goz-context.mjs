import { createHash } from 'node:crypto'
import { decodeBillingLibrary } from '@cognovis/fhir-billing-rules'

export const CONTEXT_URL = 'https://github.com/cognovis/fhir-camp-hackathon/Library/goz-context-rules'
const BASE = 'https://github.com/cognovis/fhir-camp-hackathon'
const OPS = {
  'fee-range': ['minimum', 'maximum'], justification: ['threshold'], price: [], clinical: [],
  facts: ['trueFacts'], exclude: ['excluded', 'scope'], repeat: ['maximumWithoutReason', 'scope'],
  included: ['components'], units: ['unitKinds', 'scope', 'combineCodes'], provisional: [],
  implant: ['maximumPerSession', 'maximumPerPhase', 'excluded'],
}
const TEXT_FACTS = ['episodeId', 'eventId', 'sessionId', 'targetId', 'planningObjectId', 'restorationId', 'unitKind',
  'provisionalId', 'provisionalAction', 'provisionalOrigin', 'implantId', 'implantSystem', 'phaseId',
  'phase', 'indication', 'agreementStatus', 'agreementDocument', 'agreementSignedAt', 'includedIn',
  'component', 'supportKind', 'requestAgreementDocument', 'repeatJustification']
const BOOL_FACTS = ['scopeComplete', 'historyComplete', 'agreementConfirmed', 'ordinaryExceedsStandard',
  'justificationRequested', 'justificationConfirmed', 'ownServiceConfirmed', 'contentConfirmed',
  'repeatJustificationConfirmed', 'requestConfirmed', 'requestBeforeServiceConfirmed', 'findingsRecorded', 'writtenPlan',
  'impressionTaken', 'priorProvisionalBilled', 'implantAnalysisConfirmed', 'orientationTemplateUsed',
  'implantExposureConfirmed', 'abutmentInsertionConfirmed']
const NUMBER_FACTS = ['agreementFactor', 'agreementFee', 'claimedUnitFee']
const KNOWN_FACTS = new Set([...TEXT_FACTS, ...BOOL_FACTS, ...NUMBER_FACTS, 'unitIds'])
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v) => typeof v === 'string' && v.trim() === v && v.length > 0
const positive = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0
const date = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v
const strings = (v) => Array.isArray(v) && v.length > 0 && v.every(text) && new Set(v).size === v.length
function keys(v, required, optional = []) {
  if (!isObject(v) || required.some((k) => !Object.hasOwn(v, k)) || Object.keys(v).some((k) => ![...required, ...optional].includes(k))) throw new Error('Invalid GOZ object keys')
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (isObject(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
  return JSON.stringify(value)
}
export const digest = (value) => `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`
export function validatePayload(payload) {
  keys(payload, ['schemaVersion', 'id', 'version', 'reviewedOn', 'evaluationWindow', 'factSystem', 'gozSystem', 'rules'])
  if (payload.schemaVersion !== 1 || payload.id !== 'goz-context-rules' || !text(payload.version) || !date(payload.reviewedOn) || !text(payload.factSystem) || !text(payload.gozSystem)) throw new Error('Invalid GOZ payload identity')
  keys(payload.evaluationWindow, ['start', 'end'])
  if (![payload.evaluationWindow.start, payload.evaluationWindow.end].every(date) || payload.evaluationWindow.start > payload.evaluationWindow.end) throw new Error('Invalid GOZ evaluation window')
  if (!Array.isArray(payload.rules) || !payload.rules.length) throw new Error('Missing GOZ rules')
  const ids = new Set()
  for (const rule of payload.rules) {
    keys(rule, ['id', 'operation', 'codes', 'parameters', 'provenance'])
    if (!text(rule.id) || ids.has(rule.id) || !Object.hasOwn(OPS, rule.operation) || !strings(rule.codes) || rule.codes.some((c) => !/^\d{4}$/.test(c))) throw new Error('Invalid or duplicate GOZ rule')
    ids.add(rule.id)
    keys(rule.parameters, OPS[rule.operation])
    for (const [key, value] of Object.entries(rule.parameters)) {
      if (['minimum', 'maximum', 'threshold', 'maximumWithoutReason', 'maximumPerSession', 'maximumPerPhase'].includes(key)) {
        if (!positive(value) || (key.startsWith('maximum') && key !== 'maximum' && !Number.isSafeInteger(value))) throw new Error(`Invalid ${key}`)
      } else if (key === 'combineCodes') {
        if (typeof value !== 'boolean') throw new Error('Invalid combineCodes')
      } else if (!strings(value)) throw new Error(`Invalid ${key}`)
      if (['trueFacts', 'scope'].includes(key) && value.some((f) => !(key === 'scope' ? TEXT_FACTS : BOOL_FACTS).includes(f))) throw new Error(`Unknown fact in ${key}`)
    }
    if (rule.operation === 'fee-range' && rule.parameters.minimum > rule.parameters.maximum) throw new Error('Inverted fee range')
    if (!Array.isArray(rule.provenance?.sources) || !rule.provenance.sources.length || rule.provenance.sources.some((s) => !text(s.citation) || !/^https:\/\//.test(s.uri))) throw new Error('GOZ rule lacks sources')
  }
  return payload
}
export function buildContextLibrary(payload, edition, meta) {
  validatePayload(payload)
  return {
    resourceType: 'Library', id: payload.id, meta, url: CONTEXT_URL, version: payload.version,
    status: 'active', publisher: 'FHIR Camp: source-based GOZ checks',
    type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/library-type', code: 'logic-library' }] },
    identifier: [
      { system: `${BASE}/sid/artifact-kind`, value: 'goz-context-rules' },
      { system: `${BASE}/sid/context-digest`, value: digest(payload) },
    ],
    extension: [{ url: `${BASE}/StructureDefinition/catalog-edition-digest`, valueString: decodeBillingLibrary(edition).digest }],
    relatedArtifact: [{ type: 'depends-on', resource: `${edition.url}|${edition.version}` }],
    content: [{ contentType: 'application/json', data: Buffer.from(canonical(payload)).toString('base64') }],
  }
}
export function readContextLibrary(catalog) {
  const all = catalog.entry.map((e) => e.resource)
  const matches = all.filter((r) => r.resourceType === 'Library' && (r.url === CONTEXT_URL || r.id === 'goz-context-rules'))
  if (matches.length !== 1) throw new Error('Exactly one GOZ context Library is required')
  const library = matches[0]
  if (library.url !== CONTEXT_URL || library.id !== 'goz-context-rules' || library.status !== 'active' || library.implicitRules || library.modifierExtension || library.content?.length !== 1 || library.content[0].contentType !== 'application/json') throw new Error('Invalid GOZ context Library')
  const kinds = library.identifier?.filter((i) => i.system === `${BASE}/sid/artifact-kind`) ?? []
  const types = library.type?.coding?.filter((c) => c.system === 'http://terminology.hl7.org/CodeSystem/library-type') ?? []
  if (kinds.length !== 1 || kinds[0].value !== 'goz-context-rules' || types.length !== 1 || types[0].code !== 'logic-library') throw new Error('Invalid GOZ artifact kind/type')
  const encoded = library.content[0].data
  if (typeof encoded !== 'string' || Buffer.from(encoded, 'base64').toString('base64') !== encoded) throw new Error('Invalid GOZ base64')
  const payload = validatePayload(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')))
  if (library.version !== payload.version || library.identifier?.filter((i) => i.system === `${BASE}/sid/context-digest`).length !== 1 || library.identifier.find((i) => i.system === `${BASE}/sid/context-digest`).value !== digest(payload)) throw new Error('GOZ context digest mismatch')
  const links = library.relatedArtifact
  if (links?.length !== 1 || links[0].type !== 'depends-on') throw new Error('GOZ edition binding missing')
  const editions = all.filter((r) => r.resourceType === 'Library' && `${r.url}|${r.version}` === links[0].resource)
  const binding = library.extension?.filter((e) => e.url === `${BASE}/StructureDefinition/catalog-edition-digest`)
  if (editions.length !== 1 || binding?.length !== 1 || decodeBillingLibrary(editions[0]).kind !== 'catalog-edition' || binding[0].valueString !== decodeBillingLibrary(editions[0]).digest) throw new Error('GOZ edition binding mismatch')
  return { payload, library }
}
// Exact decimal arithmetic keeps the statutory rounding after multiplication, including half-cent ties.
export function unitFeeCents(points, pointValue, factor) {
  const parts = [points, pointValue, factor].map((v) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || !/^\d+(\.\d{1,10})?$/.test(String(v))) throw new Error('Invalid fee operand')
    const [a, b = ''] = String(v).split('.')
    return [BigInt(a + b), 10n ** BigInt(b.length)]
  })
  const numerator = parts.reduce((v, p) => v * p[0], 100n)
  const denominator = parts.reduce((v, p) => v * p[1], 1n)
  const cents = (numerator * 2n + denominator) / (denominator * 2n)
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Fee overflow')
  return Number(cents)
}
export function readFacts(item, resources, system) {
  const facts = Object.create(null)
  const patient = item.subject?.reference
  for (const reference of item.supportingInformation ?? []) {
    const observation = resources.get(reference.reference)
    if (observation?.resourceType !== 'Observation' || !['final', 'amended', 'corrected'].includes(observation.status) || observation.subject?.reference !== patient || !observation.effectiveDateTime || !(observation.performer?.length || observation.derivedFrom?.length)) continue
    const codings = observation.code?.coding?.filter((c) => c.system === system) ?? []
    if (codings.length !== 1 || !KNOWN_FACTS.has(codings[0].code)) continue
    const key = codings[0].code
    let value
    if (TEXT_FACTS.includes(key) && text(observation.valueString)) value = observation.valueString
    if (BOOL_FACTS.includes(key) && typeof observation.valueBoolean === 'boolean') value = observation.valueBoolean
    if (NUMBER_FACTS.includes(key) && typeof observation.valueString === 'string' && /^\d+(\.\d{1,10})?$/.test(observation.valueString) && Number.isFinite(Number(observation.valueString))) value = Number(observation.valueString)
    if (key === 'unitIds' && observation.component?.length) {
      const values = observation.component.map((c) => c.code?.coding?.some((x) => x.system === system && x.code === 'unitId') ? c.valueString : undefined)
      if (strings(values)) value = values
    }
    if (Object.hasOwn(facts, key) && canonical(facts[key]) !== canonical(value)) facts[key] = undefined
    else if (!Object.hasOwn(facts, key)) facts[key] = value
  }
  const encounter = resources.get(item.context?.reference)
  const session = encounter?.resourceType === 'Encounter' && encounter.subject?.reference === patient ? item.context.reference : undefined
  if (facts.sessionId !== undefined && facts.sessionId !== session) facts.sessionId = undefined
  else if (session) facts.sessionId = session
  return facts
}

export function evaluateContext({ catalog, cases, account, asOf }) {
  const findings = [], prices = new Map()
  let payload, library
  try { ({ payload, library } = readContextLibrary(catalog)) } catch (error) {
    return { findings: [{ code: 'GOZ_LIBRARY_UNAVAILABLE', effect: 'needs-review', message: error.message }], prices }
  }
  if (!date(asOf) || asOf < payload.evaluationWindow.start || asOf > payload.evaluationWindow.end) return { findings: [{ code: 'GOZ_LEGAL_SNAPSHOT_UNREVIEWED', effect: 'needs-review', message: 'Date is outside the reviewed evaluation window.' }], prices }
  const resources = new Map()
  for (const { resource } of cases.entry) {
    const key = `${resource.resourceType}/${resource.id}`
    if (resources.has(key)) return { findings: [{ code: 'GOZ_INPUT_AMBIGUOUS', effect: 'needs-review', message: `Duplicate ${key}` }], prices }
    resources.set(key, resource)
  }
  const all = [...resources.values()].filter((r) => r.resourceType === 'ChargeItem' && ['planned', 'billable', 'billed'].includes(r.status)).map((r) => ({ r, code: r.code?.coding?.find((c) => c.system === payload.gozSystem)?.code, f: readFacts(r, resources, payload.factSystem) }))
  const own = all.filter(({ r }) => r.account?.some((a) => a.reference === `Account/${account}`))
  if (own.some(({ r }) => r.account.length !== 1)) return { findings: [{ code: 'GOZ_ACCOUNT_AMBIGUOUS', effect: 'needs-review', message: 'A charge belongs to more than one Account.' }], prices }
  const definitions = catalog.entry.map((e) => e.resource).filter((r) => r.resourceType === 'ChargeItemDefinition')
  const emit = (rule, line, code, message, effect = 'needs-review', related = []) => findings.push({
    code, rule: rule.id, line: line.r.id, effect, message, relatedLines: related.map((l) => l.r.id), sources: rule.provenance.sources,
  })
  const need = (rule, line, fields) => {
    const missing = fields.filter((k) => line.f[k] === undefined)
    if (missing.length) emit(rule, line, 'GOZ_EVIDENCE_REQUIRED', `Missing or conflicting facts: ${missing.join(', ')}`)
    return missing.length === 0
  }
  function group(rule, line, codes, scope, history = false) {
    if (!need(rule, line, [...scope, history ? 'historyComplete' : 'scopeComplete'])) return undefined
    if (line.f[history ? 'historyComplete' : 'scopeComplete'] !== true) { emit(rule, line, 'GOZ_HISTORY_INCOMPLETE', 'The relevant scope is not confirmed complete.'); return undefined }
    const matches = []
    for (const other of all) {
      if (!codes.includes(other.code) || other.r.subject?.reference !== line.r.subject?.reference) continue
      const sameAccount = other.r.account?.some((a) => a.reference === `Account/${account}`)
      if (!sameAccount && (!history || other.r.status === 'planned')) continue
      if (scope.some((k) => other.f[k] !== undefined && other.f[k] !== line.f[k])) continue
      if (scope.some((k) => other.f[k] === undefined)) { emit(rule, line, 'GOZ_SCOPE_AMBIGUOUS', 'A potentially related line lacks scope facts.', 'needs-review', [other]); return undefined }
      if (!Number.isSafeInteger(other.r.quantity?.value) || other.r.quantity.value < 1) { emit(rule, line, 'GOZ_QUANTITY_INVALID', 'Quantity must be a positive safe integer.', 'needs-review', [other]); return undefined }
      matches.push(other)
    }
    return matches
  }
  function agreement(rule, line) {
    if (!need(rule, line, ['agreementStatus'])) return undefined
    if (line.f.agreementStatus === 'none') return false
    if (line.f.agreementStatus === 'invalid') { emit(rule, line, 'GOZ_AGREEMENT_INVALID', 'Agreement is explicitly invalid.', 'reject'); return undefined }
    if (line.f.agreementStatus !== 'valid' || !need(rule, line, ['agreementConfirmed', 'agreementDocument', 'agreementSignedAt', 'agreementFactor', 'agreementFee'])) return undefined
    const doc = resources.get(line.f.agreementDocument)
    const signed = Date.parse(line.f.agreementSignedAt), performed = Date.parse(line.r.occurrenceDateTime)
    if (line.f.agreementConfirmed !== true || doc?.resourceType !== 'DocumentReference' || doc.status !== 'current' || !doc.content?.length || doc.subject?.reference !== line.r.subject?.reference || !Number.isFinite(signed) || !Number.isFinite(performed)) { emit(rule, line, 'GOZ_AGREEMENT_EVIDENCE_REQUIRED', 'Agreement conditions/document/timing are not confirmed.'); return undefined }
    if (line.f.agreementSignedAt.slice(0, 10) === line.r.occurrenceDateTime?.slice(0, 10) && (!line.f.agreementSignedAt.includes('T') || !line.r.occurrenceDateTime.includes('T'))) { emit(rule, line, 'GOZ_AGREEMENT_TIMING_UNKNOWN', 'Same-day agreement requires precise times.'); return undefined }
    if (signed >= performed || line.f.agreementFactor !== line.r.factorOverride) { emit(rule, line, 'GOZ_AGREEMENT_MISMATCH', 'Agreement must precede the service and cover its actual factor.', 'reject'); return undefined }
    return true
  }
  for (const rule of payload.rules) for (const line of own.filter((l) => rule.codes.includes(l.code))) {
    const f = line.f, p = rule.parameters, q = line.r.quantity?.value, factor = line.r.factorOverride
    const reject = (code, message, related) => emit(rule, line, code, message, 'reject', related)
    switch (rule.operation) {
      case 'fee-range': {
        if (!positive(factor)) { emit(rule, line, 'GOZ_FACTOR_REQUIRED', 'Missing or invalid factor.'); break }
        if (factor < p.minimum || factor > p.maximum) { const valid = agreement(rule, line); if (valid === false) reject('GOZ_FEE_OUTSIDE_RANGE', 'Factor is outside the statutory range without an agreement.') }
        break
      }
      case 'justification': {
        if (!positive(factor)) break
        if (factor <= p.threshold) break
        if (!need(rule, line, ['agreementStatus'])) break
        if (f.agreementStatus === 'valid') {
          if (agreement(rule, line) !== true || !need(rule, line, ['ordinaryExceedsStandard'])) break
          if (!f.ordinaryExceedsStandard) break
          if (!need(rule, line, ['justificationRequested'])) break
          if (!f.justificationRequested) break
        } else if (f.agreementStatus !== 'none') { emit(rule, line, 'GOZ_AGREEMENT_EVIDENCE_REQUIRED', 'Agreement status is not usable.'); break }
        if (!need(rule, line, ['justificationConfirmed'])) break
        if (f.justificationConfirmed !== true || !line.r.reason?.some((r) => text(r.text))) emit(rule, line, 'GOZ_JUSTIFICATION_REQUIRED', 'Individual justified circumstances and written explanation are required.', line.r.status === 'planned' ? 'needs-review' : 'reject')
        break
      }
      case 'price': {
        const definition = definitions.find((d) => d.code?.coding?.some((c) => c.system === payload.gozSystem && c.code === line.code))
        const component = (code) => definition?.propertyGroup?.[0]?.priceComponent?.find((c) => c.type === 'informational' && c.code?.coding?.some((x) => x.code === code))?.factor
        try {
          const cents = unitFeeCents(component('points'), component('point-value'), factor)
          prices.set(line.r.id, cents / 100)
          if ((f.claimedUnitFee ?? line.r.priceOverride) !== undefined && unitFeeCents(f.claimedUnitFee ?? line.r.priceOverride, 1, 1) !== cents) reject('GOZ_PRICE_MISMATCH', 'Claimed unit fee differs from the fee after statutory rounding.')
          if (f.agreementStatus === 'valid' && agreement(rule, line) === true && unitFeeCents(f.agreementFee, 1, 1) !== cents) reject('GOZ_AGREED_FEE_MISMATCH', 'Agreed fee and factor/points do not agree.')
        } catch { emit(rule, line, 'GOZ_PRICE_UNAVAILABLE', 'Exact price operands are missing or invalid.') }
        break
      }
      case 'clinical': {
        if (!need(rule, line, ['ownServiceConfirmed', 'contentConfirmed', 'indication'])) break
        if (f.ownServiceConfirmed !== true || f.contentConfirmed !== true) emit(rule, line, 'GOZ_SERVICE_EVIDENCE_REQUIRED', 'Own complete service or planned content must be confirmed.', line.r.status === 'planned' ? 'needs-review' : 'reject')
        if (f.indication === 'necessary') break
        if (f.indication === 'requested') {
          if (!need(rule, line, ['repeatJustificationConfirmed', 'requestConfirmed', 'requestBeforeServiceConfirmed', 'requestAgreementDocument'])) break
          const doc = resources.get(f.requestAgreementDocument)
          if (f.requestConfirmed && f.requestBeforeServiceConfirmed && doc?.resourceType === 'DocumentReference' && doc.status === 'current' && doc.content?.length && doc.subject?.reference === line.r.subject?.reference) break
          emit(rule, line, 'GOZ_REQUEST_EVIDENCE_REQUIRED', 'Requested service needs the documented prior written agreement.')
        } else if (f.indication === 'not-necessary') reject('GOZ_SERVICE_NOT_ELIGIBLE', 'Neither medically necessary nor a documented requested service.')
        else emit(rule, line, 'GOZ_INDICATION_UNKNOWN', 'Indication must be necessary, requested or not-necessary.')
        break
      }
      case 'facts': {
        if (need(rule, line, p.trueFacts) && p.trueFacts.some((k) => f[k] !== true)) emit(rule, line, 'GOZ_SERVICE_CONTENT_REQUIRED', 'Required service content is not confirmed.', line.r.status === 'planned' ? 'needs-review' : 'reject')
        break
      }
      case 'exclude': {
        const others = group(rule, line, p.excluded, p.scope)
        if (others?.length) reject('GOZ_EXCLUDED_SERVICE', 'Excluded services share the relevant treatment context.', others)
        break
      }
      case 'repeat': {
        const members = group(rule, line, rule.codes, p.scope)
        if (members && members.reduce((sum, l) => sum + l.r.quantity.value, 0) > p.maximumWithoutReason) {
          if (!need(rule, line, ['repeatJustificationConfirmed'])) break
          if (f.repeatJustificationConfirmed !== true) emit(rule, line, 'GOZ_REPEAT_JUSTIFICATION_REQUIRED', 'Repeated anaesthesia needs a written individual reason.', line.r.status === 'planned' ? 'needs-review' : 'reject')
          else need(rule, line, ['repeatJustification'])
        }
        break
      }
      case 'units': {
        if (!need(rule, line, ['unitIds', 'unitKind'])) break
        if (!p.unitKinds.includes(f.unitKind)) { reject('GOZ_WRONG_BILLING_UNIT', 'The stated billing unit does not match the service.'); break }
        const members = group(rule, line, p.combineCodes ? rule.codes : [line.code], p.scope)
        if (!members) break
        if (members.some((l) => !Array.isArray(l.f.unitIds) || l.f.unitKind !== f.unitKind)) { emit(rule, line, 'GOZ_UNIT_EVIDENCE_REQUIRED', 'Related lines lack comparable billing-unit identities.'); break }
        const ids = new Set(members.flatMap((l) => l.f.unitIds))
        if (q !== f.unitIds.length || members.reduce((sum, l) => sum + l.r.quantity.value, 0) > ids.size) reject('GOZ_UNIT_QUANTITY_MISMATCH', 'Quantity exceeds or disagrees with the stated unique billing units.', members)
        break
      }
      case 'included': {
        if (!need(rule, line, ['episodeId', 'scopeComplete'])) break
        if (!f.scopeComplete) { emit(rule, line, 'GOZ_HISTORY_INCOMPLETE', 'Treatment context is incomplete.'); break }
        const children = own.filter((l) => l.f.includedIn === `ChargeItem/${line.r.id}`)
        for (const child of children) {
          if (!need(rule, child, ['episodeId', 'component'])) continue
          if (child.f.episodeId !== f.episodeId) { emit(rule, child, 'GOZ_COMPONENT_CONTEXT_CONFLICT', 'Linked component belongs to another episode.'); continue }
          if (p.components.includes(child.f.component)) emit(rule, child, 'GOZ_COMPONENT_ALREADY_INCLUDED', 'This separately charged action is included in the referenced service.', 'reject', [line])
        }
        break
      }
      case 'provisional': {
        if (!need(rule, line, ['provisionalId', 'provisionalAction', 'provisionalOrigin', 'impressionTaken'])) break
        if (f.provisionalOrigin !== 'same-provider') { emit(rule, line, 'GOZ_PROVISIONAL_ANALOG_REVIEW', 'Other-provider or unknown origin needs an individual review.'); break }
        if (['reinsertion', 'removal'].includes(f.provisionalAction)) {
          if (need(rule, line, ['priorProvisionalBilled']) && f.priorProvisionalBilled) reject('GOZ_PROVISIONAL_ALREADY_INCLUDED', 'Reinsertion/removal of this already billed provisional is included.')
          else if (f.priorProvisionalBilled === false) emit(rule, line, 'GOZ_PROVISIONAL_HISTORY_REQUIRED', 'Original provisional billing needs review.')
        } else if (!['initial-direct', 'replacement-after-loss', 'replacement-after-defect'].includes(f.provisionalAction)) emit(rule, line, 'GOZ_PROVISIONAL_ACTION_UNKNOWN', 'Unknown provisional action.')
        else if (!f.impressionTaken) reject('GOZ_IMPRESSION_REQUIRED', '5120/5140 require the direct procedure with impression.')
        break
      }
      case 'implant': {
        if (!need(rule, line, ['implantSystem', 'phase', 'phaseId'])) break
        if (f.implantSystem !== 'two-phase' || f.phase !== 'reconstructive') { reject('GOZ_IMPLANT_PHASE_MISMATCH', '9050 requires a two-phase system in the reconstructive phase.'); break }
        const session = group(rule, line, [...rule.codes, ...p.excluded], ['episodeId', 'implantId', 'sessionId'])
        if (session) {
          const conflict = session.filter((l) => p.excluded.includes(l.code))
          if (conflict.length) reject('GOZ_IMPLANT_EXCLUSION', '9050 conflicts with 9010/9040 on this implant in this session.', conflict)
          if (session.filter((l) => rule.codes.includes(l.code)).reduce((sum, l) => sum + l.r.quantity.value, 0) > p.maximumPerSession) reject('GOZ_IMPLANT_SESSION_LIMIT', '9050 exceeds once per implant/session.', session)
        }
        const phase = group(rule, line, rule.codes, ['episodeId', 'implantId', 'phaseId'], true)
        if (phase && phase.reduce((sum, l) => sum + l.r.quantity.value, 0) > p.maximumPerPhase) reject('GOZ_IMPLANT_PHASE_LIMIT', '9050 exceeds three times in this reconstructive phase.', phase)
        break
      }
    }
  }
  return { findings, prices, library: { canonical: library.url, version: library.version, digest: digest(payload), reviewedOn: payload.reviewedOn } }
}
