import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Health Samurai React Components (the Aidbox UI library) for the FHIR panel. Its Tailwind CSS
// sits in cascade layers, so the app's own unlayered styles below still win.
import '@health-samurai/react-components/bundle.css'
import '@cognovis/react-odontogram/style.css'
import '@radix-ui/themes/styles.css'
import { Theme } from '@radix-ui/themes'
import './styles.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Theme accentColor="blue" grayColor="slate" radius="medium" appearance="light">
      <App />
    </Theme>
  </StrictMode>,
)
