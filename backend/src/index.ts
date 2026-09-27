import { loadConfig } from './config'
import { openPglite, openPostgres } from './db/client'
import { createApp } from './app'
import { DevTokenVerifier, FirebaseTokenVerifier } from './auth/verifier'
import { systemClock } from './lib/clock'

async function main() {
  const config = loadConfig()
  const database = config.DATABASE_URL ? await openPostgres(config.DATABASE_URL) : await openPglite(config.PGLITE_DATA_DIR)

  if (config.AUTH_MODE === 'dev') console.warn('[config] AUTH_MODE=dev — dev sign-in enabled (never use in production)')
  if (database.driver === 'pglite') console.warn(`[config] using embedded PGlite at ${config.PGLITE_DATA_DIR}`)

  const verifier = config.AUTH_MODE === 'dev' ? new DevTokenVerifier() : await FirebaseTokenVerifier.create(config)

  const app = createApp({ config, db: database.db, verifier, clock: systemClock })
  const server = app.listen(config.PORT, () => {
    console.log(`[bagelbite] API listening on :${config.PORT}`)
  })

  const shutdown = () => {
    server.close(() => {
      void database.close().finally(() => process.exit(0))
    })
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
