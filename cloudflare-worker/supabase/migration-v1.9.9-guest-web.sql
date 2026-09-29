alter table public.web_meetings alter column manager_user_id drop not null;
alter table public.web_meetings add column if not exists guest_host_token_hash text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'web_meetings_host_identity_check'
      and conrelid = 'public.web_meetings'::regclass
  ) then
    alter table public.web_meetings
      add constraint web_meetings_host_identity_check
      check (manager_user_id is not null or guest_host_token_hash is not null);
  end if;
end $$;

create unique index if not exists web_meetings_active_guest_session_idx
  on public.web_meetings(manager_session_id)
  where status = 'active' and manager_user_id is null;

-- participant_join_meeting was updated in production to allow guest meetings too.
