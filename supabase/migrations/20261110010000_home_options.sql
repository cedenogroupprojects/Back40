-- Nurture messages carry up to 5 homes the agent can pick from (coming soon / new / price drop).
alter table public.drafts add column if not exists home_options jsonb;
