import { loadConfig } from './config'
import { openPglite, openPostgres } from './db/client'
import { createApp } from './app'
import { DevTokenVerifier, FirebaseTokenVerifier } from './auth/verifier'
import { systemClock } from './lib/clock'
import { AnthropicAiService } from './ai/anthropic'
import { OfflineAiService } from './ai/offline'
import { DbUsageRecorder } from './ai/usage'
import { DisabledGroundingClient, TavilyGroundingClient } from './grounding/tavily'
import { SandboxExerciseValidator, SkipExerciseValidator } from './content/exerciseValidator'

async function main() {
  const config = loadConfig()
  const database = config.DATABASE_URL ? await openPostgres(config.DATABASE_URL) : await openPglite(config.PGLITE_DATA_DIR)

  if (config.AUTH_MODE === 'dev') console.warn('[config] AUTH_MODE=dev — dev sign-in enabled (never use in production)')
  if (database.driver === 'pglite') console.warn(`[config] using embedded PGlite at ${config.PGLITE_DATA_DIR}`)

  const verifier = config.AUTH_MODE === 'dev' ? new DevTokenVerifier() : await FirebaseTokenVerifier.create(config)

  const usage = new DbUsageRecorder(database.db)
  const ai =
    config.LLM_PROVIDER === 'offline'
      ? new OfflineAiService()
      : new AnthropicAiService({
          apiKey: config.ANTHROPIC_API_KEY,
          generationModel: config.CLAUDE_MODEL_GENERATION,
          gradingModel: config.CLAUDE_MODEL_GRADING,
          usage,
        })
  if (config.LLM_PROVIDER === 'offline') console.warn('[config] LLM_PROVIDER=offline — serving labelled template content, not AI output')

  const grounding =
    config.GROUNDING === 'tavily' && config.TAVILY_API_KEY
      ? new TavilyGroundingClient(config.TAVILY_API_KEY, usage)
      : new DisabledGroundingClient()
  if (!grounding.enabled) console.warn('[config] GROUNDING=off — medium/high-risk bites are marked not source-grounded')
  const validator = config.EXERCISE_VALIDATION ? new SandboxExerciseValidator() : new SkipExerciseValidator()

  const app = createApp({ config, db: database.db, verifier, clock: systemClock, ai, grounding, validator })
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
