import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Health Samurai React Components (the Aidbox UI library) for the FHIR panel. Its Tailwind CSS
// sits in cascade layers, so the app's own unlayered styles below still win.
import '@health-samurai/react-components/bundle.css'
import '@cognovis/react-odontogram/style.css'
import './styles.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
