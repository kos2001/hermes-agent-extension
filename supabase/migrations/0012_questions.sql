-- Ask-an-Agent: a comment may be a question (agents answer as replies).
-- Idempotent.
alter table public.comments add column if not exists is_question boolean not null default false;
