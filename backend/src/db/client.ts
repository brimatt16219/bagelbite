import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from './schema'

/** Driver-agnostic handle: node-postgres in production, PGlite in tests and keyless local dev. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>

export interface Database {
  db: Db
  driver: 'postgres' | 'pglite'
  close: () => Promise<void>
}

// Migrations live in backend/drizzle — one level above both src/db (tsx) and dist (bundled).
const here = path.dirname(fileURLToPath(import.meta.url))
export const migrationsFolder = path.resolve(here, here.endsWith(`${path.sep}db`) ? '../../drizzle' : '../drizzle')

export async function openPostgres(connectionString: string): Promise<Database> {
  const { Pool } = await import('pg')
  const { drizzle } = await import('drizzle-orm/node-postgres')
  const { migrate } = await import('drizzle-orm/node-postgres/migrator')
  const pool = new Pool({ connectionString, max: 10 })
  const db = drizzle(pool, { schema })
  await migrate(db, { migrationsFolder })
  return { db, driver: 'postgres', close: () => pool.end() }
}

/** `dataDir` undefined → in-memory database (tests). */
export async function openPglite(dataDir?: string): Promise<Database> {
  const { PGlite } = await import('@electric-sql/pglite')
  const { drizzle } = await import('drizzle-orm/pglite')
  const { migrate } = await import('drizzle-orm/pglite/migrator')
  if (dataDir) mkdirSync(dataDir, { recursive: true })
  const client = dataDir ? new PGlite(dataDir) : new PGlite()
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder })
  return { db, driver: 'pglite', close: () => client.close() }
}
