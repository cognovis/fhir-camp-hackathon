import { createInstance } from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json' with { type: 'json' }
import de from './locales/de.json' with { type: 'json' }

export type TranslationKey = keyof typeof en

const german: Record<TranslationKey, string> = de
export const i18n = createInstance()

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: Record<TranslationKey, string> }
    keySeparator: false
  }
}

void i18n.use(LanguageDetector).use(initReactI18next).init({
  resources: { en: { translation: en }, de: { translation: german } },
  supportedLngs: ['de', 'en'],
  nonExplicitSupportedLngs: true,
  fallbackLng: 'en',
  load: 'languageOnly',
  keySeparator: false,
  detection: { order: ['navigator'], caches: [] },
  interpolation: { escapeValue: false },
  initAsync: false,
})

export const t = (key: TranslationKey, values?: Record<string, unknown>): string => i18n.t(key, values)
export const language = (): 'de' | 'en' => i18n.resolvedLanguage === 'de' ? 'de' : 'en'
export const locale = (): string => i18n.language || 'en'
export const number = (value: number, options?: Intl.NumberFormatOptions): string => new Intl.NumberFormat(locale(), options).format(value)
export const date = (value: string): string => new Intl.DateTimeFormat(locale()).format(new Date(value))

const updateDocument = () => {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language()
    document.title = t('appTitle')
  }
}
i18n.on('languageChanged', updateDocument)
updateDocument()

// Browser preference is authoritative; cookies, URL parameters and storage cannot override it.
const updateBrowserLanguage = () => { void i18n.changeLanguage() }
if (typeof window !== 'undefined') {
  window.addEventListener('languagechange', updateBrowserLanguage)
  import.meta.hot?.dispose(() => window.removeEventListener('languagechange', updateBrowserLanguage))
}
