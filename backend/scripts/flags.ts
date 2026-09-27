/**
 * Manual content-flag review (Content-Accuracy §4 — a habit, not built tooling).
 *
 *   npm run flags                          list open flags with the flagged content
 *   npm run flags -- confirm <flagId> [note]   content is wrong → retire/regenerate it for everyone
 *   npm run flags -- dismiss <flagId> [note]   not a real problem → close it, lift any suppression
 *
 * Uses the same DATABASE_URL / PGLITE_DATA_DIR as the API.
 */
import { eq } from 'drizzle-orm'
import { openPglite, openPostgres } from '../src/db/client'
import { exerciseBankItems, lessonVariants, retrievalPromptBankItems } from '../src/db/schema'
import { confirmFlag, dismissFlag, listOpenFlags } from '../src/content/flags'

async function main() {
  const [command = 'list', flagId, ...noteParts] = process.argv.slice(2)
  const database = process.env.DATABASE_URL
    ? await openPostgres(process.env.DATABASE_URL)
    : await openPglite(process.env.PGLITE_DATA_DIR ?? '.data/pglite')
  const { db } = database
  const note = noteParts.join(' ') || null

  try {
    if (command === 'list') {
      const flags = await listOpenFlags(db)
      if (!flags.length) console.log('No open flags.')
      for (const f of flags) {
        let excerpt = ''
        if (f.targetType === 'lesson_variant') {
          const [v] = await db.select().from(lessonVariants).where(eq(lessonVariants.id, f.targetId))
          excerpt = v?.explanationMarkdown.slice(0, 300) ?? '(missing)'
        } else if (f.targetType === 'retrieval_prompt') {
          const [p] = await db.select().from(retrievalPromptBankItems).where(eq(retrievalPromptBankItems.id, f.targetId))
          excerpt = p ? `${p.prompt}\n  answer key: ${p.answerKey}` : '(missing)'
        } else {
          const [e] = await db.select().from(exerciseBankItems).where(eq(exerciseBankItems.id, f.targetId))
          excerpt = e?.instructions.slice(0, 300) ?? '(missing)'
        }
        console.log(`\n[${f.id}] ${f.targetType} ${f.targetId} — risk ${f.riskTierAtFlag} — ${f.createdAt.toISOString()}`)
        console.log(`  reason: ${f.reason ?? '(none given)'}`)
        console.log(`  ${excerpt.replace(/\n/g, '\n  ')}`)
      }
    } else if ((command === 'confirm' || command === 'dismiss') && flagId) {
      const fn = command === 'confirm' ? confirmFlag : dismissFlag
      const flag = await fn(db, flagId, note, new Date())
      console.log(`${command === 'confirm' ? 'Confirmed' : 'Dismissed'} flag ${flag.id} on ${flag.targetType} ${flag.targetId}.`)
    } else {
      console.error('Usage: npm run flags [-- confirm|dismiss <flagId> [note]]')
      process.exitCode = 1
    }
  } finally {
    await database.close()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
