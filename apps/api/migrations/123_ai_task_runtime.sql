-- ═══════════════════════════════════════════════════════════════════════════
-- 123_ai_task_runtime.sql
-- 任务编排内核：TaskRun / TaskStep / TaskEvent
--
-- 目的：把「多步任务做到哪一步」从模型上下文与 SDK 私有状态里拿出来，落 D1。
--       DO 被回收、连接断开、审批挂起后，都能按 step 状态续跑。
-- 约定：ai_task_* 是任务事实源；ai_chat_messages 仍是对话审计镜像，两者用 session_id 关联。
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `ai_task_runs` (
  `id` text PRIMARY KEY,
  `session_id` text NOT NULL,
  `user_id` text NOT NULL,
  `goal` text NOT NULL,
  `status` text NOT NULL DEFAULT 'running',
  `current_step_id` text,
  `total_steps` integer NOT NULL DEFAULT 0,
  `completed_steps` integer NOT NULL DEFAULT 0,
  `budget_used` integer NOT NULL DEFAULT 0,
  `checkpoint` text,
  `error` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  `completed_at` text
);

CREATE INDEX IF NOT EXISTS `idx_ai_task_runs_session` ON `ai_task_runs`(`session_id`, `created_at` DESC);
CREATE INDEX IF NOT EXISTS `idx_ai_task_runs_user_status` ON `ai_task_runs`(`user_id`, `status`);

CREATE TABLE IF NOT EXISTS `ai_task_steps` (
  `id` text PRIMARY KEY,
  `run_id` text NOT NULL,
  `step_index` integer NOT NULL,
  `title` text NOT NULL,
  `tool_name` text,
  `status` text NOT NULL DEFAULT 'pending',
  `input` text,
  `output` text,
  `error` text,
  `attempts` integer NOT NULL DEFAULT 0,
  `idempotency_key` text,
  `started_at` text,
  `completed_at` text,
  `updated_at` text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS `idx_ai_task_steps_run_index` ON `ai_task_steps`(`run_id`, `step_index`);
CREATE INDEX IF NOT EXISTS `idx_ai_task_steps_run_status` ON `ai_task_steps`(`run_id`, `status`);
CREATE UNIQUE INDEX IF NOT EXISTS `idx_ai_task_steps_idempotency` ON `ai_task_steps`(`run_id`, `idempotency_key`)
  WHERE `idempotency_key` IS NOT NULL;

CREATE TABLE IF NOT EXISTS `ai_task_events` (
  `id` text PRIMARY KEY,
  `run_id` text NOT NULL,
  `step_id` text,
  `type` text NOT NULL,
  `payload` text,
  `created_at` text NOT NULL
);

CREATE INDEX IF NOT EXISTS `idx_ai_task_events_run_created` ON `ai_task_events`(`run_id`, `created_at`);
