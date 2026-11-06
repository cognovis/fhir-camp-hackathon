import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

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
// Where the browser opens the Aidbox UI (the FHIR panel links each resource there). Not a secret.
const aidboxBrowser = (process.env.AIDBOX_BROWSER_URL
  ?? `http://${process.env.AIDBOX_HOST ?? 'localhost'}:${process.env.AIDBOX_PORT ?? '8080'}`).replace(/\/$/, '')

// Billing scripts the dev server runs for the app, so the Billing SDK and the Aidbox credentials
// stay out of the browser (TASKS.md, tasks 4 and 5):
//   GET  /api/cost-plan?patient=<id>   billing/cost-plan.mjs --aidbox <id> --json: every cost
//                                      plan Account of the patient, priced with the Billing SDK
//   POST /api/charges-from-plan        billing/charges-from-plan.mjs <CarePlan id> [--factor ..]:
//        { carePlan, coverage?, factors? } the Account and planned ChargeItems of one alternative
function billingEndpoints(): Plugin {
  const script = (name: string) => fileURLToPath(new URL(`../billing/${name}`, import.meta.url))
  const FHIR_ID = /^[A-Za-z0-9\-.]{1,64}$/
  const run = (args: string[], done: (error: string | undefined, stdout: string) => void) =>
    execFile(
      process.execPath,
      args,
      { env: { ...process.env, AIDBOX_URL: aidbox, AIDBOX_CLIENT: client, AIDBOX_SECRET: secret }, timeout: 60_000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => done(error ? stderr.trim() || error.message : undefined, stdout),
    )
  return {
    name: 'billing-endpoints',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '', 'http://localhost')
        const send = (status: number, body: unknown) => {
          res.statusCode = status
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(body))
        }

        if (req.method === 'GET' && url.pathname === '/api/cost-plan') {
          const patient = url.searchParams.get('patient') ?? ''
          // Only validated FHIR ids reach the command line.
          if (!FHIR_ID.test(patient)) return send(400, { error: 'patient must be a FHIR id' })
          return run([script('cost-plan.mjs'), '--aidbox', patient, '--json'], (error, stdout) => {
            if (error) return send(502, { error })
            try { send(200, JSON.parse(stdout)) } catch { send(502, { error: 'cost-plan.mjs returned no JSON' }) }
          })
        }

        if (req.method === 'POST' && url.pathname === '/api/charges-from-plan') {
          let raw = ''
          req.on('data', (chunk) => { raw += chunk; if (raw.length > 10_000) req.destroy() })
          req.on('end', () => {
            let body: unknown
            try { body = JSON.parse(raw) } catch { return send(400, { error: 'JSON body expected' }) }
            const isObject = (value: unknown): value is Record<string, unknown> =>
              typeof value === 'object' && value !== null && !Array.isArray(value)
            if (!isObject(body)) return send(400, { error: 'JSON object expected' })
            const carePlan = typeof body.carePlan === 'string' ? body.carePlan : ''
            if (!FHIR_ID.test(carePlan)) return send(400, { error: 'carePlan must be a FHIR id' })
            const factors = body.factors === undefined ? {} : body.factors
            if (!isObject(factors)) return send(400, { error: 'factors must be an object of GOZ number to multiplier' })
            const factorArgs: string[] = []
            if (body.coverage !== undefined) {
              if (typeof body.coverage !== 'string' || !FHIR_ID.test(body.coverage)) return send(400, { error: 'coverage must be a FHIR id' })
              factorArgs.push('--coverage', body.coverage)
            }
            for (const [code, factor] of Object.entries(factors)) {
              if (!/^[0-9]{4}[a-z]?$/.test(code) || typeof factor !== 'number' || !(factor > 0 && factor <= 10)) {
                return send(400, { error: `factor ${code}: expected a GOZ number and a multiplier` })
              }
              factorArgs.push('--factor', `${code}=${factor}`)
            }
            run([script('charges-from-plan.mjs'), carePlan, ...factorArgs], (error, stdout) => {
              if (error) return send(502, { error })
              send(200, { message: stdout.trim() })
            })
          })
          return
        }

        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), billingEndpoints()],
  define: { __AIDBOX_BROWSER_URL__: JSON.stringify(aidboxBrowser) },
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
