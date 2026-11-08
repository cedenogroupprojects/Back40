-- Natural-voice briefing audio (ElevenLabs), cached so the same script is never generated twice.
alter table public.ai_usage add column voice_calls int not null default 0;

-- Private bucket; the voice function hands out short-lived signed URLs.
insert into storage.buckets (id, name, public) values ('voice', 'voice', false)
on conflict (id) do nothing;
