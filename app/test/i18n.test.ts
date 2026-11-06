import assert from 'node:assert/strict'
import { test } from 'node:test'
import en from '../src/locales/en.json' with { type: 'json' }
import de from '../src/locales/de.json' with { type: 'json' }

let preferences: string[] = ['en-US']
Object.defineProperty(globalThis, 'navigator', { configurable: true, get: () => ({ languages: preferences, language: preferences[0] }) })
const events = new EventTarget()
Object.defineProperty(globalThis, 'window', { configurable: true, value: events })
Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: { lang: '' }, title: '', cookie: 'i18next=fr' } })
const { i18n, language, locale, t, number } = await import('../src/i18n.ts')
const { findingText } = await import('../src/costPlan.ts')

const detect = async (languages: string[]) => {
  preferences = languages
  await i18n.changeLanguage()
}

test('browser language order and supported regional variants are respected', async () => {
  for (const [preferences, expectedLanguage, expectedLocale] of [
    [['de-CH', 'en-US'], 'de', 'de-CH'],
    [['en-GB', 'de-DE'], 'en', 'en-GB'],
    [['fr-FR', 'de-AT'], 'de', 'de-AT'],
    [['pt-BR'], 'en', 'en'],
    [[], 'en', 'en'],
  ] as const) {
    await detect([...preferences])
    assert.equal(language(), expectedLanguage)
    assert.equal(locale(), expectedLocale)
    assert.equal(document.documentElement.lang, expectedLanguage)
  }
})

test('all translations have matching keys and placeholders', () => {
  assert.deepEqual(Object.keys(de).sort(), Object.keys(en).sort())
  for (const key of Object.keys(en) as (keyof typeof en)[]) {
    assert.ok(de[key].trim())
    const placeholders = (value: string) => [...value.matchAll(/{{(\w+)}}/g)].map(m => m[1]).sort()
    assert.deepEqual(placeholders(de[key]), placeholders(en[key]), key)
  }
})

test('browser changes update document, UI messages and regional number formatting', async () => {
  await detect(['en-US'])
  assert.equal(t('recheck'), 'Re-check')
  assert.equal(t('findingCount', { count: 1 }), '1 finding')
  assert.equal(number(1234.5), '1,234.5')
  preferences = ['de-DE']
  const changed = new Promise<void>(resolve => i18n.once('languageChanged', () => resolve()))
  events.dispatchEvent(new Event('languagechange'))
  await changed
  assert.equal(document.documentElement.lang, 'de')
  assert.equal(t('recheck'), 'Erneut prüfen')
  assert.equal(t('findingCount', { count: 1 }), '1 Hinweis')
  assert.equal(number(1234.5), '1.234,5')
})

test('the same finding is explained in the active language without changing its content', async () => {
  const finding = { code: 'REQUIRED_FACT_UNAVAILABLE', rule: 'goz-9040-implantSystem', details: { fact: 'system|implantSystem' } }
  const original = structuredClone(finding)
  await detect(['en-US'])
  assert.match(findingText(finding), /implant system/)
  await detect(['de-DE'])
  assert.match(findingText(finding), /Implantatsystem/)
  assert.deepEqual(finding, original)
  assert.deepEqual(i18n.options.detection.order, ['navigator'])
  assert.deepEqual(i18n.options.detection.caches, [])
})

test('missing navigator falls back to English', async () => {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: undefined })
  await i18n.changeLanguage()
  assert.equal(language(), 'en')
  assert.equal(t('recheck'), 'Re-check')
})
