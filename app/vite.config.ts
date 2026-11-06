import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync } from 'node:fs'

// The browser talks to /fhir on the dev server; Vite forwards it to the local Aidbox and adds
// the Basic credentials of the root client from docker-compose.yml. The credentials therefore
// never reach the browser bundle. Override with AIDBOX_URL, AIDBOX_CLIENT and AIDBOX_SECRET.
// Read AIDBOX_PORT and the other settings from the repository's .env, as Docker Compose does.
// Variables already set in the environment win.
const envFile = new URL('../.env', import.meta.url)
if (existsSync(envFile)) process.loadEnvFile?.(envFile)

const aidbox = (process.env.AIDBOX_URL ?? `http://localhost:${process.env.AIDBOX_PORT ?? '8080'}`).replace(/\/$/, '')
const client = process.env.AIDBOX_CLIENT ?? 'root'
const secret = process.env.AIDBOX_SECRET ?? 'hackathon'

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.APP_PORT ?? 5173),
    proxy: {
      '/fhir': {
        target: aidbox,
        changeOrigin: true,
        headers: { authorization: `Basic ${Buffer.from(`${client}:${secret}`).toString('base64')}` },
      },
    },
  },
})
