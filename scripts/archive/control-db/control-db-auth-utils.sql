-- Control DB auth utilities
-- Provides user verification state lookup for invitations and onboarding flows.
-- Run this script against the control database.

create or replace function public.user_verification_state(user_email text)
returns table(
  user_exists boolean,
  email_confirmed boolean,
  last_sign_in_at timestamptz
)
language sql
security definer
set search_path = public, auth, extensions
as $$
  with u as (
    select email, email_confirmed_at, last_sign_in_at
    from auth.users
    where lower(email) = lower($1)
    limit 1
  )
  select true as user_exists,
         (u.email_confirmed_at is not null) as email_confirmed,
         u.last_sign_in_at
  from u
  union all
  select false as user_exists,
         false as email_confirmed,
         null::timestamptz as last_sign_in_at
  where not exists (select 1 from u)
  limit 1;
$$;

comment on function public.user_verification_state(text) is
  'Returns a single row indicating whether a user exists in auth.users and whether their email is confirmed.';
