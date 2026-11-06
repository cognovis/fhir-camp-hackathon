import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@cognovis/react-odontogram/style.css'
import './styles.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
