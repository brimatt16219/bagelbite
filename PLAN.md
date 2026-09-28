# Bagelbite v1 — Implementation Plan

Derived from the vault docs (see `PROJECT_NOTES.md` §1 for the synthesis and §2 for every
interpretation call). Progress is tracked in the vault's `Tasks.md`.

---

## 1. Architecture

```
Browser (Vercel)                         Express API (Railway)                     External
┌────────────────────────┐   HTTPS     ┌──────────────────────────────┐
│ React + React Router    │  Bearer    │ auth middleware (Firebase /   │──────▶ Firebase Auth (verify)
│ TanStack Query          │  ID token  │   dev mode)                   │
│ Firebase Auth (Google)  │──────────▶│ routes: topics, bites, reviews │──────▶ Anthropic (Sonnet/Haiku)
│ Sandpack (tests run     │   SSE      │ services: enrollment, content, │──────▶ Tavily (grounding)
│   client-side)          │◀──────────│   grading, fsrs, mastery,      │
└────────────────────────┘  (chat)    │   composer, adaptive, chat     │
                                       │ Drizzle ORM                    │──────▶ Postgres (Railway)
                                       │ exercise validator (sandboxed  │        / PGlite (dev, tests)
                                       │   child process)               │
                                       └──────────────────────────────┘
```

- **Shared vs. personal data** follows `Content-Sharing.md`. Shared: topics, relations, skeletons,
  nodes, lesson variants, prompt/exercise banks. Personal: enrollment, node state, review
  items/logs, attempts, chat, flags.
- **All Claude calls are server-side** behind one `LlmClient` interface (Anthropic implementation,
  offline dev implementation, scripted fake in tests). Every call logs token usage to `llm_calls`.
- **Generation is lazy and deduplicated.** An in-process promise map keyed by `(node, tier)`, plus
  unique constraints, stop two concurrent requests from generating the same content twice.
- **Time is injected** (a `Clock` dependency), so FSRS and mastery are testable across days.

## 2. Directory structure

```
bagelbite/
├── PLAN.md  PROJECT_NOTES.md  README.md
├── package.json                 # root convenience scripts (dev/test/lint/typecheck for both apps)
├── shared/api.ts                # type-only API contract, imported by both apps via @shared/*
├── .github/workflows/ci.yml
├── backend/
│   ├── src/
│   │   ├── index.ts             # process entry: config → db → migrate → listen
│   │   ├── app.ts               # createApp(deps) — Express app factory (used by tests)
│   │   ├── config.ts            # zod-validated env, production guards
│   │   ├── db/                  # schema.ts, client.ts (pg | pglite), migrate.ts
│   │   ├── auth/                # middleware.ts, firebase.ts
│   │   ├── llm/                 # types.ts, anthropic.ts, offline.ts, prompts.ts, schemas.ts
│   │   ├── grounding/           # tavily.ts
│   │   ├── content/             # enrollment.ts, lessons.ts, exerciseValidator.ts, wikiLinks.ts, topicNames.ts
│   │   ├── learning/            # fsrs.ts, mastery.ts, composer.ts, adaptive.ts, sessions.ts, grading.ts
│   │   ├── routes/              # topics.ts, bites.ts, reviews.ts, users.ts, chat.ts
│   │   └── lib/                 # errors.ts, clock.ts, http.ts
│   ├── drizzle/                 # generated SQL migrations
│   ├── scripts/                 # flags.ts (manual flag review), metrics.sql
│   └── test/                    # vitest + supertest, PGlite in-memory, fake LLM
└── frontend/
    └── src/
        ├── main.tsx  App.tsx (layout)  index.css (theme tokens)
        ├── lib/                 # api.ts, queryClient.ts, router.tsx, firebase.ts, sse.ts
        ├── components/ui/       # Button, Card, ProgressBar, StatusBadge, SegmentedToggle, TextInput, Toast…
        └── features/
            ├── auth/            # AuthProvider, SignInScreen, RequireAuth
            ├── topics/          # HomePage, TopicPage, DashboardPage, TopicCard, DisambiguationPicker
            ├── bites/           # BitePage, ExplanationPanel, RetrievalPromptCard, ConfidenceRating,
            │                    #   CitationElement, FlagButton, ExercisePanel (Sandpack), ChatPanel
            └── reviews/         # ReviewsPage, ReviewCard
```

## 3. Data model (Postgres, via Drizzle)

Shared: `topics`, `topic_relations`, `curriculum_skeletons` (+ `author_user_id` and `visibility`,
unused in v1), `skeleton_nodes`, `lesson_variants`, `retrieval_prompt_bank_items`,
`exercise_bank_items` (+ `component_type`).

Personal: `users` (+ `subscription_tier`), `user_topic_progress` (unique on
`user_id, curriculum_skeleton_id`), `user_node_states`, `bite_attempts`, `review_items`,
`review_logs`, `chat_messages`, `content_flags`, `pretest_results` (reserved, unused).

Instrumentation: `llm_calls`, `learning_sessions`, `bite_view_events`, `mastery_events`.

Field-level shapes follow `Architecture.md` → "Data model (sketch)", with the additions listed in
`PROJECT_NOTES.md` §2.25.

## 4. Key interfaces

```ts
interface LlmClient {
  generateStructured<T>(req: { callType: LlmCallType; tier: "generation" | "grading";
    system: string; user: string; schema: ZodType<T>; maxTokens: number; userId?: string }): Promise<T>;
  streamChat(req: { system: string; messages: ChatTurn[]; userId: string;
    onText: (delta: string) => void; signal?: AbortSignal }): Promise<string>;
  readonly source: "anthropic" | "offline" | "fake";
}
interface GroundingClient { search(query: string): Promise<GroundingSource[]> }
interface ExerciseValidator { validate(ex: { solutionCode; starterCode; testSpec }): Promise<ValidationResult> }
interface Clock { now(): Date }
```

API (all require `Authorization: Bearer`, except `/health`):

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness |
| GET | `/users/me` | upsert and return the current user |
| POST | `/topics/enroll` | `{topic, baseline}` → `resolved` / `disambiguate` / `unsupported` |
| GET | `/users/me/enrollments` | topic cards: progress, due count, status |
| GET | `/topics/:topicId/enrollment` | enrollment + node states (curriculum view) |
| GET | `/topics/:topicId/next` | session composer: `reviews` / `bite` / `waiting` / `completed` |
| GET | `/bites/:id` | compose a bite (lazy generation, tier assignment, selection) |
| POST | `/bites/:id/retrieval-prompts/:promptId/response` | grade (Haiku) + log + create review item |
| POST | `/review-logs/:id/rating` | self-rating → FSRS reschedule → mastery check |
| POST | `/bites/:id/attempts` | record the client-side test result |
| POST | `/bites/:id/reveal-solution` | after 3 failed attempts; counts as a hint |
| POST | `/bites/:id/chat` | SSE chat tutor (Sonnet, capped history) |
| GET | `/bites/:id/chat` | chat history for the bite |
| POST | `/bites/:id/flag` | `ContentFlag` on shared content (high tier suppresses) |
| GET | `/users/me/reviews/due` | due review items across all topics |
| GET | `/users/me/dashboard` | mastery-weighted progress + due count |

## 5. Milestones

Each milestone ends with lint + typecheck + tests green, then one Conventional Commit.

| # | Milestone | Done when (testable) |
|---|---|---|
| M1 | **Frontend foundations**: router wiring, Tailwind theme tokens, starter template removed, app shell, UI primitives | `npm run build`, `lint` and `test` pass in `frontend/`; primitives have render tests; no Vite demo content remains |
| M2 | **Backend foundation**: Express app factory, config validation, Drizzle schema + migrations, pg/PGlite client, auth middleware (Firebase + dev), `/health`, `/users/me`, error handling, CORS | supertest: 401 without a token, 401 with a bad token, `/users/me` upserts; migrations apply cleanly on PGlite; production config rejects dev modes |
| M3 | **LLM + grounding layer**: `LlmClient` (Anthropic structured output + streaming), usage logging, offline client, Tavily client, prompt builders | Unit tests: usage rows are written per call; offline outputs validate against the same zod schemas; Tavily request shape and error handling |
| M4 | **Enrollment + topic scoping**: normalization/dedup, resolved/disambiguate/unsupported, shared skeleton reuse, relations, enrollment + node states, enrollments list, curriculum endpoint | Tests: first enrollment generates one skeleton; a second user reuses it (no LLM call); disambiguation creates no topic rows; unsupported path; idempotent re-enroll; nodes without prerequisites are `available` |
| M5 | **Lesson content pipeline**: `ensureContent(node, tier)` with grounding, claims, high-tier verification (regenerate → hedge), exercise validation sandbox, wiki-links, dedupe, `GET /bites/:id` composition, cache hit/miss logging, suppression | Tests: low tier skips grounding; medium grounds and stores claims; high verifies, retries once, then hedges; invalid exercises are rejected; the validator times out infinite loops; second view is a cache hit with no LLM call; ownership enforced |
| M6 | **Retrieval, FSRS, mastery, composer**: grading with the misconception bank, review logs, rating, `ts-fsrs` scheduling, sessions, mastery gate + unlocks, percentComplete, due reviews, `/next` | Tests (fake clock): correct/incorrect grading paths; a matched misconception serves the pre-authored correction; FSRS due dates move forward; mastery needs 2 sessions; dependents unlock only after mastery; composer prefers due reviews |
| M7 | **Attempts, adaptive difficulty, flags, chat tutor** | Tests: attempt numbering + first-try signal; tier switches below 80% / above 85%; high-tier flag suppresses and forces regeneration, low tier logs only; flag target must belong to the bite; SSE chat streams, persists and caps history |
| M8 | **Frontend features**: auth, home (enroll + disambiguation + cards), topic page, bite view (explanation + prompts + confidence + rating + citation + flags + chat; Sandpack exercise + attempts + reveal), reviews, dashboard | Component tests for the disambiguation picker, retrieval/confidence flow and citation element; `build` passes; manual E2E in the browser (M10) |
| M9 | **Ops & docs**: CI workflow, metrics SQL, flag-review script, deploy configs, env examples, README | CI YAML runs the same commands that pass locally; README covers setup/run/test/env/structure |
| M10 | **Verification**: full suite, lint, typecheck; run the app end-to-end; requirement checklist; skeptical review + fixes | Everything green; every checklist item in §6 is ticked with evidence |

## 6. Requirement checklist (from MVP-Synthesis §5) — verified 2026-09-27

Evidence: **T** = automated test (`backend/test/*`, `frontend/src/**/*.test.tsx`), **B** = exercised in the
browser against the live API, **C** = code/config inspection. "Live-key only" items are fully
implemented but could not be run against the real service here (no credentials on this machine).

- [x] Google sign-in (Firebase Auth) — C + T (verifier mapping); dev sign-in exercised in B. *Live-key only for real Google sign-in.*
- [x] Topic entry + one-line baseline, no pretest — T (`enrollment.test.ts`), B
- [x] Shared `CurriculumSkeleton` once per topic, reused; per-node `riskTier`; 2–4 related topics as `TopicRelation`s — T; B (second learner typing "sql  JOINS" got the same topic and lesson)
- [x] Topic scoping: umbrella → 3–4 candidates → picker; out-of-vertical → declined — T (backend + `topics.test.tsx`), B (`.NET`)
- [x] Shared `LessonVariant` / prompt / exercise banks, lazy per `(node, tier)`, 2 tiers, cached forever — T (`bites.test.ts`: cache hit, concurrent dedupe, suppression regeneration)
- [x] Explanation interleaved with retrieval prompts (recall / explain-back / apply) + misconception banks — T, B (progressive reveal)
- [x] Sandpack exercise with a required, validated test spec — T (real sandbox: validation, repair, drop), B (Sandpack 0/3 → 3/3)
- [x] Grounding (Tavily) medium/high; `claims` for medium; verification + regenerate + hedge for high — T (fake grounding/AI incl. fail-closed). *Live-key only against real Tavily/Claude.*
- [x] Personal `UserTopicProgress` (pinned version) + `UserNodeState` (tier, selection, progress) — T
- [x] Citation element on every bite (sources or "general knowledge" marker, never fabricated) — T, B
- [x] Flag button + `ContentFlag` on every block, targeting shared content; high tier suppresses; manual review CLI — T, B, CLI run
- [x] Test-based exercise grading (client) + Haiku retrieval grading with the misconception bank first — T, B (misconception path)
- [x] Confidence self-rating (1–4) before every reveal — T (`bites.test.tsx`), B (button disabled until chosen)
- [x] `ts-fsrs` `ReviewItem`/`ReviewLog`; composer serves due reviews first — T (fake clock across days)
- [x] Mastery gate (≥2 correct spaced sessions) + mastery-weighted dashboard with due counts — T, B (dashboard)
- [x] Deterministic adaptive difficulty → `scaffoldingTier` — T (`interaction.test.ts`)
- [x] In-bite chat tutor (Sonnet, streamed, capped history) — T (SSE, cap, errors), B (offline tutor). *Live-key only for real Sonnet.*
- [x] Model tiering: Haiku grading (temperature 0), Sonnet generation/chat (no sampling params) — T (`ai.test.ts`)
- [x] Instrumentation floor (attempts, responses, review logs, sessions, flags, token usage, cache hit/miss, mastery events, lifecycle timestamps) — T (`metrics.test.ts` runs every query in `scripts/metrics.sql`)
- [x] Wiki-link references → `TopicRelation`s — T
- [x] Error states follow the UI-Kit copy convention; generation shows skeleton loaders — C, T (error copy), B
- [x] Production guards: dev auth / offline AI / grounding off / missing DB, key or CORS origin all refuse startup — T, and the built server was run with dev settings under `NODE_ENV=production` and exited with every problem listed
