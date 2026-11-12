-- Which version of the writing rules a waiting message was written with, so older ones can be rewritten.
alter table drafts add column if not exists prompt_v int not null default 1;
