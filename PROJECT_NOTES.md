# Bagelbite — Project Notes

Running log for the autonomous v1 build that started 2026-09-26. The source of truth for product
and architecture is the Obsidian vault (`Projects/Bagelbite/*.md`, imported via the local
`CLAUDE.md`). This file records how those docs were interpreted and what happened during the build,
so the work can be resumed if a session is interrupted. The live task list is the vault's
`Tasks.md` (vault rule: no task files inside project repos); milestones are defined in `PLAN.md`.

---

## 1. Synthesis

**What:** an AI-powered learning app that teaches programming/tech topics through "bites":
short lessons interleaved with produce-an-answer retrieval prompts, plus a real, test-graded code
exercise, with an in-bite chat tutor. It is built around learning science, not content delivery:
retrieval practice, FSRS spaced repetition, and mastery-gated progression.

**For whom:** upskillers with adjacent knowledge (knows JS, wants React), self-paced, desktop.

**Doc hierarchy:** `MVP-Synthesis.md` + `Content-Sharing.md` are the final v1 scope. They override
older text in `Product-Spec.md`, `Architecture.md` and `Pedagogy.md` wherever those still show
superseded designs, such as the per-user `Bite` entity, diagnostic pretesting, the graph screen and
AWS Lambda. `Topic-Scoping.md` (v1-critical), `Course-Bank.md` and `Interaction-Components.md`
(schema-only for v1) were added afterwards.

**The v1 core loop (MVP-Synthesis §2):**
1. Enroll with a topic and a one-line self-reported baseline. There is no pretest.
2. The scoping + curriculum call (Sonnet) either resolves the topic to a shared `CurriculumSkeleton`
   (ordered `SkeletonNode`s with a `riskTier` each, plus 2–4 related topics stored as
   `TopicRelation`s) or returns 3–4 disambiguation candidates for an umbrella topic. A skeleton is
   generated once per topic and reused by every later enrollment.
3. A bite is composed from shared content generated lazily per `(SkeletonNode, scaffoldingTier)`:
   a `LessonVariant` with the explanation, a pool of `RetrievalPromptBankItem`s (each with
   anticipated misconceptions), and a pool of `ExerciseBankItem`s (each with a required test spec).
4. Accuracy floor: low-tier content is generated freely. Medium and high tiers run a Tavily
   grounding search first; medium adds self-cited claims; high adds a second verification call
   (regenerate once, then hedge). Every bite shows a citation element, and every content block has a
   flag button.
5. Grading: exercises are graded by tests in Sandpack on the client. Retrieval answers are graded
   by Haiku against an `answerKey`, and a pre-authored misconception correction is served when one
   matches.
6. Confidence self-rating (1–4) before every reveal.
7. FSRS (`ts-fsrs`) schedules one `ReviewItem` per prompt per user. The session composer serves
   due reviews ahead of new content.
8. Mastery gate: at least 2 correct (good/easy) retrievals in separate sessions before a concept
   counts as mastered and unlocks the nodes that depend on it. Progress is mastery-weighted.
9. Adaptive difficulty: a deterministic signal picks the scaffolding tier for the next node.
10. Chat tutor (Sonnet, streamed, history capped).
11. Instrumentation floor: attempts, review logs, sessions, flags, token usage, cache hit/miss,
    mastery events, lifecycle timestamps.

**Stack (locked):** React + Vite + TS + Tailwind v4, TanStack Query, React Router, lucide-react,
Sandpack, Express + TS, Postgres (Railway), Firebase Auth (Google), Anthropic Claude (Sonnet for
generation and chat, Haiku for grading), Tavily grounding, `ts-fsrs`. Hosting: Vercel + Railway.
AWS Lambda is cut; there is no background pre-generation.

**Explicitly not v1:** diagnostic pretest, topic-graph screen (the data is still captured),
`TopicGroundingCache`, AI grading of exercises, interleaving, elaboration/dual coding, transfer
tasks, gamification, forgetting-curve UI, course bank (schema fields only), non-code exercise types
(schema discriminator only), rate limits, Stripe (the `subscriptionTier` field only), mobile.

**Acceptance criteria used for "done":** every bullet in `MVP-Synthesis.md` §5 "V1 feature list"
exists and is exercised by a test or a manual run. See the requirement checklist in `PLAN.md` §6.

---

## 2. Ambiguities, gaps and contradictions — decisions taken

Each item: what was unclear → what was decided → why.

1. **Pairing directive vs. autonomous build.** `Decisions.md` (2026-07-01) says to pair and to
   revisit that decision explicitly rather than drift into autopilot. On 2026-09-26 Brian
   explicitly instructed a full autonomous build and removed the pairing rule from `CLAUDE.md`. →
   Logged as a new decision in the vault's `Decisions.md`.
2. **Planning files in the repo vs. the vault's "no task files in project dirs" rule.** →
   `PROJECT_NOTES.md` and `PLAN.md` (explicitly requested) live in the repo as design/plan docs.
   The checkbox task list mirroring the milestones lives in the vault's `Tasks.md`.
3. **"Commit after each milestone" vs. one-branch-per-task, PR, squash-merge.** `gh` is not
   installed, so PRs can't be opened from here. → All milestones are committed to one feature
   branch, `feat/v1-mvp`, with Conventional Commit messages. Brian opens the PR.
4. **Sampling temperature.** The docs require temperature 0–0.3 for generation and 0.7–1.0 for
   chat, but Claude Sonnet 5 (the model the cost model priced) rejects sampling parameters with a
   400. → Sonnet 5 calls send no temperature. Consistency comes from structured outputs (a JSON
   schema), low-latency settings and explicit prompt rules. Haiku grading uses `temperature: 0`.
   Model IDs are configurable via env (`CLAUDE_MODEL_GENERATION`, `CLAUDE_MODEL_GRADING`).
5. **Model IDs.** Sonnet → `claude-sonnet-5`, Haiku → `claude-haiku-4-5`.
6. **Exercise language.** Sandpack runs JavaScript in the browser, but topics can be Rust, SQL,
   Python and so on. → Every `code_exercise` is a plain JavaScript ES module (`/solution.js`)
   with Jest-style tests (`/solution.test.js`). For non-JS topics the generator models the concept
   in JS (for example, SQL join semantics over arrays), while explanations and retrieval prompts use
   the real language. Exercises are pure logic (no DOM, no JSX), so specs can be validated
   server-side.
7. **"A small shared bank can be spec-checked once."** → At generation time every exercise is run
   in a locked-down child process: Node permission model, empty environment, timeout, and a
   minimal test harness. The solution must pass every test and the starter code must fail at least
   one. Exercises that fail are regenerated once with the failure fed back, then dropped. This runs
   LLM-generated code only, never user submissions.
8. **Where exercise grading happens.** The docs say tests run client-side in Sandpack. → The
   server records the client-reported result. User code never executes on the server, which is a
   deliberate security choice. Faking a pass only affects your own progress.
9. **What counts as "separate spaced sessions" for mastery.** → The server tracks learning
   sessions (a new session after 30 minutes of inactivity). A concept is mastered when each of its
   taught prompts has correct answers rated good/easy in at least 2 distinct sessions.
10. **Mastery gating granularity.** A strict linear gate would stall progress for days after every
    bite. → Gating follows `SkeletonNode.scaffoldsOn`, and the skeleton prompt asks for genuine
    prerequisites only. **Watch item:** pacing can still feel slow on chain-shaped curricula. This
    is the intended pedagogy, but worth checking against real activation data.
11. **`UserNodeState.status` has no "unlocked but not started" value.** → The enum is extended to
    `locked | available | in_progress | mastered`, with lifecycle timestamps (`startedAt`,
    `teachingCompletedAt`, `completedAt`).
12. **Retrieval flow.** The API sketch describes one call that grades and schedules, while Product
    Spec flow 3 has the learner self-rate Again/Hard/Good/Easy after the reveal. → Two steps:
    `POST …/response` grades and logs (with confidence), then `POST /review-logs/:id/rating`
    applies FSRS. Wrong answers are auto-rated `again` by the client. The same flow is used at first
    exposure and in reviews.
13. **Misconception feedback "hybrid".** → One Haiku grading call returns
    `{correct, matchedMisconceptionIndex, feedback}`. If a misconception matched, the pre-authored
    correction is served. Otherwise the call's own targeted feedback is the live correction, so no
    second call is needed.
14. **High-tier flag: "suppress pending regeneration".** → The flagged item is suppressed
    immediately. The next request for that `(node, tier)` regenerates it (still grounded and
    verified). The flag stays `open` for Brian's manual review, done through a CLI script
    (`npm run flags`) rather than an admin UI, per the docs. Confirming a flag on low/medium content
    supersedes it, so it regenerates on the next view.
15. **Topic deduplication (open task).** → Existing topics are matched on a normalized name.
    Otherwise the scoping call receives a short list of similar existing topics and can answer
    "this is topic X", reusing its skeleton. No extra call.
16. **Out-of-vertical topics** (cooking, tax law, medical) are rejected by the product decision
    but not by any designed mechanism. → The enroll response gains a third branch,
    `{status: "unsupported", message}`.
17. **What the baseline personalizes.** → It feeds scoping (narrowing umbrella topics) and the chat
    tutor's context. The shared skeleton is generated for a generic upskiller. Everyone starts on
    the `standard` tier, and `prunedNodeIds` stays empty (pretest deferred).
18. **Adaptive difficulty mapping with only 2 tiers.** → The signal is the rolling first-attempt
    success rate (first exercise attempt passing, plus first-exposure retrieval correctness) over
    the last 12 events in the enrollment, with a minimum of 4 events. Below 80% →
    `extra_scaffolding`. Above 85% → `standard`. In between → keep the current tier.
19. **"Hints used"** has no defined UI. → It counts chat-tutor questions asked during the bite
    before the attempt, plus revealing the worked solution (offered after 3 failed attempts).
20. **Interleaving prompts into the explanation.** → The explanation is written as one `##`
    section per concept (maximum 4, the chunking cap). The bite shows section → prompt → section →
    prompt, and the learner must answer before the next section reveals.
21. **Bank sizes.** → Each `(node, tier)` generation produces 5 retrieval prompts and 2 exercises
    (Content-Sharing's 6–10 per node accumulates across tiers). 3 prompts are selected per bite.
22. **Routes not listed in Architecture.** → `/reviews` is added (flow 3 needs a screen) and `/graph`
    is not built (deferred). `/topics/:topicId` shows the curriculum with a Continue button. After
    enrolling, the learner is dropped straight into bite 1 (flow 1, step 7).
23. **No local infrastructure** (no Postgres, Docker, API keys or Firebase project on the machine).
    → Drizzle ORM runs on `pg` when `DATABASE_URL` is set, or on embedded PGlite (real Postgres
    compiled to WASM) otherwise, used for tests and keyless local development.
24. **Local runs without credentials.** → `AUTH_MODE=dev` (backend) plus `VITE_AUTH_MODE=dev`
    (frontend) adds a labelled dev sign-in. `LLM_PROVIDER=offline` serves clearly labelled,
    templated offline content, with a banner in the UI. `GROUNDING=off` marks medium/high content as
    not grounded. All three are refused at startup when `NODE_ENV=production`. The real Firebase,
    Anthropic and Tavily paths are fully implemented and are the defaults.
25. **Schema additions beyond the Architecture sketch:** `SkeletonNode.title`,
    `ExerciseBankItem.instructions`, `suppressedAt`/`supersededAt` on shared content,
    `LessonVariant.verification`, instrumentation tables (`llm_calls`, `learning_sessions`,
    `bite_view_events`, `mastery_events`), and `ReviewLog` fields (`isFirstExposure`,
    `gradingSource`, `feedback`, `sessionId`, `ratedAt`).
26. **Chat prompt caching** is listed under Someday in `Tasks.md` but called a "cheap
    implementation-time win" in `Architecture.md`. → A `cache_control` breakpoint is added on the
    bite-context system prompt. It costs nothing if the prefix is too short to cache.
27. **Wiki-links** `[[Topic]]` in lesson markdown become `related` `TopicRelation`s (creating a stub
    `Topic` if needed) and render as emphasized text, since there is no graph screen.

---

## 3. Build log

- **2026-09-26** — Read all 17 vault docs. No Postgres, Docker, API keys or `gh` locally → PGlite,
  dev auth, offline LLM for local verification. Created branch `feat/v1-mvp` from the uncommitted
  `feat/frontend-foundations` work. Wrote this file and `PLAN.md`.
- **M1 done** — theme tokens, UI primitives, shell, routing. Primary buttons use dark text on the
  accent fill because white on `#e39a5c` fails WCAG AA (Design.md already flags accessibility as open).
  Commits are made by Brian; Claude hands over the commit command at each milestone.
- **M2 done** — Express 5 app factory, zod config with production guards, Drizzle schema (20 tables)
  + generated migration, pg/PGlite client, Firebase/dev token verifiers, user upsert, JSON error
  handler. 9 tests. Bundled `dist/` boots and migrates an on-disk PGlite (smoke-tested). Note: PGlite's
  node fs needs the data dir's parent to exist — `openPglite` creates it.
- **M3 done** — `AiService` semantic interface (scope, generateLesson, repairExercises, verifyLesson,
  hedgeLesson, grade, streamTutor) with three implementations: Anthropic (structured outputs via
  `messages.parse` + zod, Sonnet 5 without sampling params, Haiku at temperature 0, streamed tutor
  with thinking off and a cached system prompt), offline (labelled templates for keyless dev), and a
  scripted test fake. Token usage is logged per call to `llm_calls`. Tavily grounding **fails
  closed**: a failed search throws instead of returning nothing, because shared lesson content is
  cached forever — silently caching ungrounded content for every future learner would defeat the
  safety floor. 25 tests.
- **M4 done** — `POST /topics/enroll`, `GET /users/me/enrollments`, `GET /topics/:topicId/enrollment`.
  Exact normalized-name hit on a topic with a skeleton → reuse, no Claude call. Otherwise one scope
  call receives up to 12 similar existing topics and may return `matchedExistingTopicId` (dedup).
  Disambiguate/unsupported write nothing. Related topics become stub `topics` + `topic_relations`
  (edge direction: enrolled topic → suggested topic, `relationType` describes the suggested topic's
  role). A stub topic is reused and gets a skeleton when someone later enrolls in it. Concurrent
  first-enrollments are resolved by the partial unique index (one current canonical skeleton per
  topic); the loser re-reads the winner. Node states start `available` iff the node has no
  prerequisites. 36 tests.
- **M5 done** — `GET /bites/:id`. Lazy `(node, tier)` generation with in-process dedupe + partial
  unique index; grounding per risk tier (fail closed on search errors, honest "not source-grounded"
  marker when grounding is disabled); high tier: verify → regenerate once with concerns → hedge.
  Exercise validator: static contract check + two sandboxed runs (solution passes ≥2 tests, starter
  fails ≥1) in `node --permission --eval <harness>` with an empty env, 64 MB heap, 5 s kill. Verified
  by probe: file access is refused ("Access to this API has been restricted"), infinite loops are
  killed. **Residual risk:** Node 22's permission model does not restrict network, so a
  prompt-injected exercise could make outbound requests during validation (no credentials or files
  are reachable). Invalid exercises get one repair call, then are dropped — a bite can be served
  without an exercise (logged as a content bug) rather than with an untested one. Tier is assigned
  on first open from the adaptive signal; views log cache hit/miss; wiki-links become relations.
  On Windows, `spawn(..., {env: {}})` still exposes ~11 OS default vars (HOMEPATH, TEMP…) — no
  secrets; Linux/Railway gets an empty env. 52 tests.
- **M6 done** — `POST /bites/:id/retrieval-prompts/:promptId/response`, `POST /review-logs/:id/rating`,
  `GET /users/me/reviews/due`, `GET /topics/:topicId/next`, `GET /users/me/dashboard`. Added migration
  `0001` (`review_items.last_rated_at`): a card is created when first answered but only counts as
  due after its first self-rating — otherwise an unrated answer would appear in the due list
  immediately. ts-fsrs with `enable_short_term: false` (first ratings → ~1/2/3/8 days). Guards:
  one first exposure per question, rate before re-answering it, reviews only when due, wrong answers
  can only be rated "again", and only the latest answer on an item can be rated (a superseded,
  abandoned answer can't apply FSRS twice). Mastery = teaching complete + every taught question
  correct and rated good/easy in ≥2 distinct sessions; mastering unlocks dependents and updates
  mastery-weighted progress + a `mastery_events` row. 65 tests.
- **M7 done** — `POST /bites/:id/attempts` (client-reported Sandpack result; passing must be
  all-tests-pass; hintsUsed = tutor questions + solution reveal), `POST /bites/:id/reveal-solution`
  (after 3 failed attempts), `POST /bites/:id/flag` (target must be content from this bite's node;
  high-risk → suppressed at once, regenerated + re-verified on next view; repeat flag idempotent),
  `GET/POST /bites/:id/chat` (SSE; learner message persisted first; history capped at 8 and forced
  to start with a user turn; validation errors are JSON, mid-stream failures are an `error` event;
  client disconnect aborts the upstream stream). `npm run flags` CLI: list / confirm (lesson →
  suppressed so the next view regenerates a new version; prompt/exercise → superseded, never
  selected again) / dismiss (lifts suppression when no other open flag remains). Backend complete:
  77 tests.
- **M8 done** — Frontend: auth (Firebase Google + labelled dev sign-in), home (topic + baseline,
  disambiguation picker, unsupported message, due-review banner, topic cards), curriculum page
  (composer "what's next", statuses, locked prerequisites, related topics → prefilled home), bite view
  (split layout; sections reveal as each question is rated; confidence → reveal → self-rating;
  citation; flag on every block; tutor chat over SSE; Sandpack exercise with client-side tests,
  attempts, reveal-after-3, localStorage code persistence), reviews session, progress dashboard.
  Route pages are lazy-loaded (entry 207 kB; Sandpack's ~800 kB only on the bite route). 21 tests.
  **Verified end to end in the browser** against the live API (keyless dev config): sign-in →
  `.NET` disambiguation → enroll → bite 1 → 3 answers (incl. misconception path) → Sandpack
  0/3 then 3/3 → "Bite complete" → tutor chat → flag → "What's next" → bite 2; curriculum, locked
  bite, reviews and dashboard pages. Bugs found and fixed during that run: (1) Sandpack calls
  `onComplete` inside its own state updater → deferred our handling out of its render;
  (2) re-running unchanged code recorded a new attempt → deduped by code fingerprint;
  (3) dev-mode token provider was registered in an effect that runs after children's queries →
  moved to module scope with a module-level session (also fixed stale token after sign-out).
  Note: Sandpack's test runner loads its bundler from codesandbox.io, so exercises need internet.
