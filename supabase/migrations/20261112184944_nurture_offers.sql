-- Programs / incentives an agent wants Back 40 to mention (closing costs paid, rate buydowns…).
alter table nurture_settings add column if not exists offers jsonb not null default '[]'::jsonb;
