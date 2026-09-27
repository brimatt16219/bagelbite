import { z } from 'zod'

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  /** Postgres connection string (Railway). Unset → embedded PGlite (dev only). */
  DATABASE_URL: z.string().url().optional(),
  PGLITE_DATA_DIR: z.string().default('.data/pglite'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  AUTH_MODE: z.enum(['firebase', 'dev']).default('firebase'),
  FIREBASE_PROJECT_ID: z.string().optional(),
  /** Service-account JSON (raw or base64). Optional when running on GCP with default credentials. */
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),

  LLM_PROVIDER: z.enum(['anthropic', 'offline']).default('anthropic'),
  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_MODEL_GENERATION: z.string().default('claude-sonnet-5'),
  CLAUDE_MODEL_GRADING: z.string().default('claude-haiku-4-5'),

  GROUNDING: z.enum(['tavily', 'off']).default('tavily'),
  TAVILY_API_KEY: z.string().optional(),

  /** Server-side exercise spec validation (runs generated code in a sandboxed child process). */
  EXERCISE_VALIDATION: booleanish.default(true),
})

export type Config = z.infer<typeof envSchema> & { corsOrigins: string[] }

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new ConfigError(`Invalid environment: ${issues}`)
  }
  const cfg = parsed.data
  const problems: string[] = []

  if (cfg.NODE_ENV === 'production') {
    // Dev conveniences must never reach production.
    if (cfg.AUTH_MODE === 'dev') problems.push('AUTH_MODE=dev is not allowed in production')
    if (cfg.LLM_PROVIDER === 'offline') problems.push('LLM_PROVIDER=offline is not allowed in production')
    if (cfg.GROUNDING === 'off') problems.push('GROUNDING=off is not allowed in production (grounding is a safety requirement)')
    if (!cfg.EXERCISE_VALIDATION) problems.push('EXERCISE_VALIDATION=false is not allowed in production')
    if (!cfg.DATABASE_URL) problems.push('DATABASE_URL is required in production')
    if (!cfg.ANTHROPIC_API_KEY) problems.push('ANTHROPIC_API_KEY is required in production')
  }
  if (cfg.AUTH_MODE === 'firebase' && !cfg.FIREBASE_PROJECT_ID) {
    problems.push('FIREBASE_PROJECT_ID is required when AUTH_MODE=firebase')
  }
  if (cfg.GROUNDING === 'tavily' && !cfg.TAVILY_API_KEY && cfg.NODE_ENV !== 'test') {
    problems.push('TAVILY_API_KEY is required when GROUNDING=tavily (set GROUNDING=off for keyless local dev)')
  }
  if (problems.length) throw new ConfigError(problems.join('; '))

  return {
    ...cfg,
    corsOrigins: cfg.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  }
}
