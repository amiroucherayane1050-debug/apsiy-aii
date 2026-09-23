begin;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  credits integer not null default 0 check (credits >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  delta integer not null check (delta <> 0),
  kind text not null check (kind in ('stripe', 'generation', 'refund')),
  external_id text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.video_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id text unique,
  prompt text not null,
  status text not null default 'IN_QUEUE',
  video_url text,
  credit_refunded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists video_jobs_user_created_idx
  on public.video_jobs (user_id, created_at desc);

create index if not exists credit_transactions_user_created_idx
  on public.credit_transactions (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.video_jobs enable row level security;

drop policy if exists "Users can read their profile" on public.profiles;
create policy "Users can read their profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can read their credit transactions"
  on public.credit_transactions;
create policy "Users can read their credit transactions"
  on public.credit_transactions for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can read their video jobs" on public.video_jobs;
create policy "Users can read their video jobs"
  on public.video_jobs for select
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists create_profile_after_signup on auth.users;
create trigger create_profile_after_signup
  after insert on auth.users
  for each row execute function public.create_profile_for_new_user();

insert into public.profiles (user_id)
select id from auth.users
on conflict (user_id) do nothing;

create or replace function public.consume_credit(
  p_user_id uuid,
  p_external_id text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credits integer;
  v_inserted boolean := false;
begin
  if p_user_id is null or coalesce(p_external_id, '') = '' then
    raise exception 'Invalid credit debit request';
  end if;

  insert into public.profiles (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  insert into public.credit_transactions (user_id, delta, kind, external_id)
  values (p_user_id, -1, 'generation', p_external_id)
  on conflict (external_id) do nothing
  returning true into v_inserted;

  if not coalesce(v_inserted, false) then
    select credits into v_credits
    from public.profiles
    where user_id = p_user_id;
    return v_credits;
  end if;

  update public.profiles
  set credits = credits - 1,
      updated_at = now()
  where user_id = p_user_id
    and credits > 0
  returning credits into v_credits;

  if v_credits is null then
    delete from public.credit_transactions
    where external_id = p_external_id;
    return -1;
  end if;

  return v_credits;
end;
$$;

create or replace function public.grant_credits(
  p_user_id uuid,
  p_amount integer,
  p_external_id text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credits integer;
begin
  if p_user_id is null or p_amount <= 0 or coalesce(p_external_id, '') = '' then
    raise exception 'Invalid credit grant request';
  end if;

  insert into public.profiles (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  with inserted as (
    insert into public.credit_transactions (user_id, delta, kind, external_id)
    values (p_user_id, p_amount, 'stripe', p_external_id)
    on conflict (external_id) do nothing
    returning 1
  )
  update public.profiles
  set credits = credits + p_amount,
      updated_at = now()
  where user_id = p_user_id
    and exists (select 1 from inserted)
  returning credits into v_credits;

  if v_credits is null then
    select credits into v_credits
    from public.profiles
    where user_id = p_user_id;
  end if;

  return v_credits;
end;
$$;

create or replace function public.refund_credit(
  p_user_id uuid,
  p_external_id text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credits integer;
begin
  if p_user_id is null or coalesce(p_external_id, '') = '' then
    raise exception 'Invalid credit refund request';
  end if;

  insert into public.profiles (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  with inserted as (
    insert into public.credit_transactions (user_id, delta, kind, external_id)
    values (p_user_id, 1, 'refund', p_external_id)
    on conflict (external_id) do nothing
    returning 1
  )
  update public.profiles
  set credits = credits + 1,
      updated_at = now()
  where user_id = p_user_id
    and exists (select 1 from inserted)
  returning credits into v_credits;

  if v_credits is null then
    select credits into v_credits
    from public.profiles
    where user_id = p_user_id;
  end if;

  return v_credits;
end;
$$;

revoke all on function public.consume_credit(uuid, text) from public, anon, authenticated;
revoke all on function public.grant_credits(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.refund_credit(uuid, text) from public, anon, authenticated;

grant execute on function public.consume_credit(uuid, text) to service_role;
grant execute on function public.grant_credits(uuid, integer, text) to service_role;
grant execute on function public.refund_credit(uuid, text) to service_role;

commit;
