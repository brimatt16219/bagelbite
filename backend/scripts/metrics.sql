-- Bagelbite: "is this working?" queries (vault MVP-Synthesis §4 — manual queries, not dashboards).
-- Run against the production database, e.g. `psql "$DATABASE_URL" -f scripts/metrics.sql`.
-- Each block is independent; edit the pricing CTE in §5 if Anthropic/Tavily prices change.

-- 1. Activation — share of learners who finished their first bite (Journey Stage 4).
select
  count(distinct utp.user_id) as learners_enrolled,
  count(distinct utp.user_id) filter (where uns.teaching_completed_at is not null) as finished_bite_1,
  round(100.0 * count(distinct utp.user_id) filter (where uns.teaching_completed_at is not null)
        / nullif(count(distinct utp.user_id), 0), 1) as activation_pct
from user_topic_progress utp
join user_node_states uns on uns.user_topic_progress_id = utp.id
join skeleton_nodes sn on sn.id = uns.skeleton_node_id
where sn.order_index = 0;

-- 2. Retention proxy — accuracy at first exposure vs. at the first spaced review, per concept.
--    The core hypothesis: accuracy should hold (or rise) after the spacing gap.
with ranked as (
  select rl.review_item_id, rl.correct,
         row_number() over (partition by rl.review_item_id order by rl.created_at) as attempt
  from review_logs rl
  where rl.rating is not null
)
select t.name as topic, sn.title as concept,
       round(avg(case when r.attempt = 1 then r.correct::int end) * 100, 1) as first_exposure_pct,
       round(avg(case when r.attempt = 2 then r.correct::int end) * 100, 1) as first_review_pct,
       count(*) filter (where r.attempt = 2) as first_reviews
from ranked r
join review_items ri on ri.id = r.review_item_id
join retrieval_prompt_bank_items p on p.id = ri.retrieval_prompt_bank_item_id
join skeleton_nodes sn on sn.id = p.skeleton_node_id
join curriculum_skeletons cs on cs.id = sn.curriculum_skeleton_id
join topics t on t.id = cs.topic_id
group by t.name, sn.title
having count(*) filter (where r.attempt = 2) > 0
order by first_reviews desc;

-- 3. Mastery reach — of the concepts learners started, how many ever got mastered.
select count(*) filter (where started_at is not null) as concepts_started,
       count(*) filter (where status = 'mastered') as concepts_mastered,
       round(100.0 * count(*) filter (where status = 'mastered')
             / nullif(count(*) filter (where started_at is not null), 0), 1) as mastery_reach_pct,
       round(avg(me.sessions_count), 2) as avg_sessions_to_master
from user_node_states uns
left join mastery_events me on me.user_node_state_id = uns.id;

-- 4. Drop-off — for learners inactive 14+ days, the curriculum position of the last bite they touched.
with last_touch as (
  select distinct on (utp.user_id) utp.user_id, sn.order_index, uns.teaching_completed_at is not null as finished_it
  from user_topic_progress utp
  join user_node_states uns on uns.user_topic_progress_id = utp.id
  join skeleton_nodes sn on sn.id = uns.skeleton_node_id
  where uns.started_at is not null
    and utp.last_activity_at < now() - interval '14 days'
  order by utp.user_id, uns.started_at desc
)
select order_index + 1 as bite_position, finished_it, count(*) as learners
from last_touch group by 1, 2 order by 1, 2;

-- 5. Actual LLM + search cost per active learner, last 30 days (vs. Cost-Model's ~$0.67/month).
--    Prices are USD per million tokens (standard rates), Tavily per search.
with pricing(model_prefix, input_per_mtok, output_per_mtok, cache_read_per_mtok) as (
  values ('claude-sonnet-5', 3.0, 15.0, 0.30),
         ('claude-haiku-4-5', 1.0, 5.0, 0.10)
), costed as (
  select c.user_id, c.call_type, c.model,
         case when c.provider = 'tavily' then 0.005
              else (c.input_tokens * p.input_per_mtok + c.output_tokens * p.output_per_mtok
                    + c.cache_read_tokens * p.cache_read_per_mtok) / 1e6
         end as usd
  from llm_calls c
  left join pricing p on c.model like p.model_prefix || '%'
  where c.created_at > now() - interval '30 days' and c.success
)
select call_type, model, count(*) as calls, round(sum(usd)::numeric, 4) as usd
from costed group by call_type, model order by usd desc;

select round((sum(usd) / nullif((select count(distinct user_id) from learning_sessions
                                  where last_activity_at > now() - interval '30 days'), 0))::numeric, 4)
       as usd_per_active_learner_30d
from (
  select case when c.provider = 'tavily' then 0.005
              when c.model like 'claude-haiku%' then (c.input_tokens * 1.0 + c.output_tokens * 5.0) / 1e6
              else (c.input_tokens * 3.0 + c.output_tokens * 15.0 + c.cache_read_tokens * 0.3) / 1e6 end as usd
  from llm_calls c where c.created_at > now() - interval '30 days' and c.success
) x;

-- ---------------------------------------------------------------------------------- supporting checks

-- Shared-content amortization (Content-Sharing): how often a bite view reused existing content.
select count(*) as bite_views, round(100.0 * avg(cache_hit::int), 1) as cache_hit_pct from bite_view_events;

-- Risk-tier mix actually produced by curriculum generation (Cost-Model assumed 70/25/5).
select risk_tier, count(*), round(100.0 * count(*) / sum(count(*)) over (), 1) as pct
from skeleton_nodes group by risk_tier order by risk_tier;

-- Adaptive difficulty: first-attempt exercise pass rate (target band 80–85%).
select round(100.0 * avg(passed::int), 1) as first_attempt_pass_pct, count(*) as first_attempts
from bite_attempts where attempt_number = 1;

-- Confidence calibration: accuracy by self-rated confidence (well calibrated = rising accuracy).
select confidence_rating, count(*) as answers, round(100.0 * avg(correct::int), 1) as accuracy_pct
from review_logs group by confidence_rating order by confidence_rating;

-- Session mix (composer behaviour; Cost-Model assumed ~40% new-content / 60% review-only).
select case when had_new_content and had_review then 'mixed'
            when had_new_content then 'new_content' else 'review_only' end as kind,
       count(*) as sessions
from learning_sessions group by 1;

-- Open content flags, most recent first (review with `npm run flags`).
select risk_tier_at_flag, target_type, count(*) as open_flags
from content_flags where status = 'open' group by 1, 2 order by 1, 2;

-- Bites served without an exercise (every generated exercise failed validation) — a prompt-quality bug.
select t.name as topic, sn.title as concept, lv.scaffolding_tier
from lesson_variants lv
join skeleton_nodes sn on sn.id = lv.skeleton_node_id
join curriculum_skeletons cs on cs.id = sn.curriculum_skeleton_id
join topics t on t.id = cs.topic_id
where lv.superseded_at is null
  and not exists (select 1 from exercise_bank_items e
                  where e.skeleton_node_id = lv.skeleton_node_id and e.superseded_at is null);
