CREATE TYPE "public"."chat_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."component_type" AS ENUM('code_exercise', 'production_prompt', 'problem_set', 'case_study_response');--> statement-breakpoint
CREATE TYPE "public"."content_source" AS ENUM('anthropic', 'offline', 'fake');--> statement-breakpoint
CREATE TYPE "public"."enrollment_status" AS ENUM('in_progress', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."flag_status" AS ENUM('open', 'reviewed', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."flag_target_type" AS ENUM('lesson_variant', 'retrieval_prompt', 'exercise');--> statement-breakpoint
CREATE TYPE "public"."grading_source" AS ENUM('misconception_bank', 'live');--> statement-breakpoint
CREATE TYPE "public"."node_status" AS ENUM('locked', 'available', 'in_progress', 'mastered');--> statement-breakpoint
CREATE TYPE "public"."prompt_kind" AS ENUM('recall', 'explain_back', 'apply_scenario');--> statement-breakpoint
CREATE TYPE "public"."relation_type" AS ENUM('prerequisite', 'related', 'deepens', 'branches_from');--> statement-breakpoint
CREATE TYPE "public"."review_rating" AS ENUM('again', 'hard', 'good', 'easy');--> statement-breakpoint
CREATE TYPE "public"."risk_tier" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."scaffolding_tier" AS ENUM('standard', 'extra_scaffolding');--> statement-breakpoint
CREATE TYPE "public"."skeleton_visibility" AS ENUM('canonical', 'private', 'unlisted', 'published');--> statement-breakpoint
CREATE TYPE "public"."subscription_tier" AS ENUM('free', 'pro');--> statement-breakpoint
CREATE TABLE "bite_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_node_state_id" uuid NOT NULL,
	"exercise_bank_item_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"session_id" uuid,
	"submitted_code" text NOT NULL,
	"passed" boolean NOT NULL,
	"tests_passed" integer NOT NULL,
	"tests_total" integer NOT NULL,
	"hints_used" integer NOT NULL,
	"attempt_number" integer NOT NULL,
	"time_taken_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bite_view_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"user_node_state_id" uuid NOT NULL,
	"skeleton_node_id" uuid NOT NULL,
	"scaffolding_tier" "scaffolding_tier" NOT NULL,
	"cache_hit" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_node_state_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "chat_role" NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" "flag_target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"user_node_state_id" uuid,
	"reason" text,
	"risk_tier_at_flag" "risk_tier" NOT NULL,
	"status" "flag_status" DEFAULT 'open' NOT NULL,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "curriculum_skeletons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"content_source" "content_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	"author_user_id" text,
	"visibility" "skeleton_visibility" DEFAULT 'canonical' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercise_bank_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skeleton_node_id" uuid NOT NULL,
	"generated_with_lesson_variant_id" uuid,
	"component_type" "component_type" DEFAULT 'code_exercise' NOT NULL,
	"instructions" text NOT NULL,
	"starter_code" text NOT NULL,
	"solution_code" text NOT NULL,
	"test_spec" text NOT NULL,
	"suitable_tiers" "scaffolding_tier"[] NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"content_source" "content_source" NOT NULL,
	"validated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"suppressed_at" timestamp with time zone,
	"superseded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "learning_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_activity_at" timestamp with time zone NOT NULL,
	"had_new_content" boolean DEFAULT false NOT NULL,
	"had_review" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lesson_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skeleton_node_id" uuid NOT NULL,
	"scaffolding_tier" "scaffolding_tier" NOT NULL,
	"explanation_markdown" text NOT NULL,
	"grounding_status" text NOT NULL,
	"grounding_sources" jsonb,
	"claims" jsonb,
	"verification" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"content_source" "content_source" NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"suppressed_at" timestamp with time zone,
	"superseded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "llm_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_type" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_creation_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer NOT NULL,
	"success" boolean NOT NULL,
	"error_code" text,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mastery_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"user_node_state_id" uuid NOT NULL,
	"skeleton_node_id" uuid NOT NULL,
	"sessions_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pretest_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"question" text NOT NULL,
	"user_answer" text NOT NULL,
	"correct" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retrieval_prompt_bank_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skeleton_node_id" uuid NOT NULL,
	"generated_with_lesson_variant_id" uuid,
	"prompt" text NOT NULL,
	"kind" "prompt_kind" NOT NULL,
	"answer_key" text NOT NULL,
	"suitable_tiers" "scaffolding_tier"[] NOT NULL,
	"anticipated_misconceptions" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"content_source" "content_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"suppressed_at" timestamp with time zone,
	"superseded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "review_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"retrieval_prompt_bank_item_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"user_node_state_id" uuid NOT NULL,
	"fsrs" jsonb NOT NULL,
	"due" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_item_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"session_id" uuid,
	"user_response" text NOT NULL,
	"correct" boolean NOT NULL,
	"feedback" text NOT NULL,
	"grading_source" "grading_source" NOT NULL,
	"matched_misconception_index" integer,
	"confidence_rating" integer NOT NULL,
	"is_first_exposure" boolean NOT NULL,
	"rating" "review_rating",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "skeleton_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"curriculum_skeleton_id" uuid NOT NULL,
	"order_index" integer NOT NULL,
	"title" text NOT NULL,
	"objective" text NOT NULL,
	"risk_tier" "risk_tier" NOT NULL,
	"scaffolds_on" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_topic_id" uuid NOT NULL,
	"to_topic_id" uuid NOT NULL,
	"relation_type" "relation_type" NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topics_normalized_name_unique" UNIQUE("normalized_name")
);
--> statement-breakpoint
CREATE TABLE "user_node_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_topic_progress_id" uuid NOT NULL,
	"skeleton_node_id" uuid NOT NULL,
	"scaffolding_tier" "scaffolding_tier" DEFAULT 'standard' NOT NULL,
	"status" "node_status" NOT NULL,
	"selected_prompt_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"selected_exercise_id" uuid,
	"solution_revealed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"teaching_completed_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_topic_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"topic_id" uuid NOT NULL,
	"curriculum_skeleton_id" uuid NOT NULL,
	"curriculum_skeleton_version" integer NOT NULL,
	"self_reported_baseline" text NOT NULL,
	"pruned_node_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"status" "enrollment_status" DEFAULT 'in_progress' NOT NULL,
	"percent_complete" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"photo_url" text DEFAULT '' NOT NULL,
	"subscription_tier" "subscription_tier" DEFAULT 'free' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bite_attempts" ADD CONSTRAINT "bite_attempts_user_node_state_id_user_node_states_id_fk" FOREIGN KEY ("user_node_state_id") REFERENCES "public"."user_node_states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bite_attempts" ADD CONSTRAINT "bite_attempts_exercise_bank_item_id_exercise_bank_items_id_fk" FOREIGN KEY ("exercise_bank_item_id") REFERENCES "public"."exercise_bank_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bite_attempts" ADD CONSTRAINT "bite_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bite_attempts" ADD CONSTRAINT "bite_attempts_session_id_learning_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."learning_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bite_view_events" ADD CONSTRAINT "bite_view_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bite_view_events" ADD CONSTRAINT "bite_view_events_user_node_state_id_user_node_states_id_fk" FOREIGN KEY ("user_node_state_id") REFERENCES "public"."user_node_states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bite_view_events" ADD CONSTRAINT "bite_view_events_skeleton_node_id_skeleton_nodes_id_fk" FOREIGN KEY ("skeleton_node_id") REFERENCES "public"."skeleton_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_node_state_id_user_node_states_id_fk" FOREIGN KEY ("user_node_state_id") REFERENCES "public"."user_node_states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_flags" ADD CONSTRAINT "content_flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_flags" ADD CONSTRAINT "content_flags_user_node_state_id_user_node_states_id_fk" FOREIGN KEY ("user_node_state_id") REFERENCES "public"."user_node_states"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum_skeletons" ADD CONSTRAINT "curriculum_skeletons_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum_skeletons" ADD CONSTRAINT "curriculum_skeletons_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_bank_items" ADD CONSTRAINT "exercise_bank_items_skeleton_node_id_skeleton_nodes_id_fk" FOREIGN KEY ("skeleton_node_id") REFERENCES "public"."skeleton_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_bank_items" ADD CONSTRAINT "exercise_bank_items_generated_with_lesson_variant_id_lesson_variants_id_fk" FOREIGN KEY ("generated_with_lesson_variant_id") REFERENCES "public"."lesson_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_sessions" ADD CONSTRAINT "learning_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_variants" ADD CONSTRAINT "lesson_variants_skeleton_node_id_skeleton_nodes_id_fk" FOREIGN KEY ("skeleton_node_id") REFERENCES "public"."skeleton_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mastery_events" ADD CONSTRAINT "mastery_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mastery_events" ADD CONSTRAINT "mastery_events_user_node_state_id_user_node_states_id_fk" FOREIGN KEY ("user_node_state_id") REFERENCES "public"."user_node_states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mastery_events" ADD CONSTRAINT "mastery_events_skeleton_node_id_skeleton_nodes_id_fk" FOREIGN KEY ("skeleton_node_id") REFERENCES "public"."skeleton_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pretest_results" ADD CONSTRAINT "pretest_results_enrollment_id_user_topic_progress_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."user_topic_progress"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_prompt_bank_items" ADD CONSTRAINT "retrieval_prompt_bank_items_skeleton_node_id_skeleton_nodes_id_fk" FOREIGN KEY ("skeleton_node_id") REFERENCES "public"."skeleton_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_prompt_bank_items" ADD CONSTRAINT "retrieval_prompt_bank_items_generated_with_lesson_variant_id_lesson_variants_id_fk" FOREIGN KEY ("generated_with_lesson_variant_id") REFERENCES "public"."lesson_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_retrieval_prompt_bank_item_id_retrieval_prompt_bank_items_id_fk" FOREIGN KEY ("retrieval_prompt_bank_item_id") REFERENCES "public"."retrieval_prompt_bank_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_user_node_state_id_user_node_states_id_fk" FOREIGN KEY ("user_node_state_id") REFERENCES "public"."user_node_states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_review_item_id_review_items_id_fk" FOREIGN KEY ("review_item_id") REFERENCES "public"."review_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_session_id_learning_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."learning_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skeleton_nodes" ADD CONSTRAINT "skeleton_nodes_curriculum_skeleton_id_curriculum_skeletons_id_fk" FOREIGN KEY ("curriculum_skeleton_id") REFERENCES "public"."curriculum_skeletons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_relations" ADD CONSTRAINT "topic_relations_from_topic_id_topics_id_fk" FOREIGN KEY ("from_topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_relations" ADD CONSTRAINT "topic_relations_to_topic_id_topics_id_fk" FOREIGN KEY ("to_topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_node_states" ADD CONSTRAINT "user_node_states_user_topic_progress_id_user_topic_progress_id_fk" FOREIGN KEY ("user_topic_progress_id") REFERENCES "public"."user_topic_progress"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_node_states" ADD CONSTRAINT "user_node_states_skeleton_node_id_skeleton_nodes_id_fk" FOREIGN KEY ("skeleton_node_id") REFERENCES "public"."skeleton_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_node_states" ADD CONSTRAINT "user_node_states_selected_exercise_id_exercise_bank_items_id_fk" FOREIGN KEY ("selected_exercise_id") REFERENCES "public"."exercise_bank_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_topic_progress" ADD CONSTRAINT "user_topic_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_topic_progress" ADD CONSTRAINT "user_topic_progress_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_topic_progress" ADD CONSTRAINT "user_topic_progress_curriculum_skeleton_id_curriculum_skeletons_id_fk" FOREIGN KEY ("curriculum_skeleton_id") REFERENCES "public"."curriculum_skeletons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bite_attempts_node_state_idx" ON "bite_attempts" USING btree ("user_node_state_id");--> statement-breakpoint
CREATE INDEX "chat_messages_node_state_idx" ON "chat_messages" USING btree ("user_node_state_id","created_at");--> statement-breakpoint
CREATE INDEX "content_flags_target_idx" ON "content_flags" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "curriculum_skeletons_current_canonical_uq" ON "curriculum_skeletons" USING btree ("topic_id") WHERE "curriculum_skeletons"."visibility" = 'canonical' and "curriculum_skeletons"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "exercise_bank_items_node_idx" ON "exercise_bank_items" USING btree ("skeleton_node_id");--> statement-breakpoint
CREATE INDEX "learning_sessions_user_idx" ON "learning_sessions" USING btree ("user_id","last_activity_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_variants_current_uq" ON "lesson_variants" USING btree ("skeleton_node_id","scaffolding_tier") WHERE "lesson_variants"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "llm_calls_created_idx" ON "llm_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "retrieval_prompts_node_idx" ON "retrieval_prompt_bank_items" USING btree ("skeleton_node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_items_user_prompt_uq" ON "review_items" USING btree ("user_id","retrieval_prompt_bank_item_id");--> statement-breakpoint
CREATE INDEX "review_items_user_due_idx" ON "review_items" USING btree ("user_id","due");--> statement-breakpoint
CREATE INDEX "review_logs_item_idx" ON "review_logs" USING btree ("review_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skeleton_nodes_order_uq" ON "skeleton_nodes" USING btree ("curriculum_skeleton_id","order_index");--> statement-breakpoint
CREATE UNIQUE INDEX "topic_relations_edge_uq" ON "topic_relations" USING btree ("from_topic_id","to_topic_id","relation_type");--> statement-breakpoint
CREATE UNIQUE INDEX "user_node_states_enrollment_node_uq" ON "user_node_states" USING btree ("user_topic_progress_id","skeleton_node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_topic_progress_user_skeleton_uq" ON "user_topic_progress" USING btree ("user_id","curriculum_skeleton_id");