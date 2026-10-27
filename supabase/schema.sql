-- 敲木鱼：功德表、原子加功德、全站统计
-- 在 Supabase Dashboard → SQL Editor 中整段执行一次

create table if not exists public.merit (
  user_id uuid primary key references auth.users (id) on delete cascade,
  total bigint not null default 0 check (total >= 0),
  today_date date not null default current_date,
  today_count integer not null default 0 check (today_count >= 0),
  updated_at timestamptz not null default now()
);

alter table public.merit enable row level security;

drop policy if exists "merit_select_own" on public.merit;
create policy "merit_select_own"
  on public.merit for select
  to authenticated
  using (auth.uid() = user_id);

grant select on public.merit to authenticated;

create or replace function public.add_merit(n integer)
returns table (total bigint, today_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if n is null or n < 1 or n > 500 then
    raise exception 'invalid amount';
  end if;

  insert into public.merit as m (user_id, total, today_date, today_count, updated_at)
  values (uid, n, current_date, n, now())
  on conflict (user_id) do update set
    total = m.total + excluded.total,
    today_count = case
      when m.today_date = current_date then m.today_count + excluded.today_count
      else excluded.today_count
    end,
    today_date = current_date,
    updated_at = now();

  return query
    select m.total, m.today_count
    from public.merit m
    where m.user_id = uid;
end;
$$;

revoke all on function public.add_merit(integer) from public;
revoke all on function public.add_merit(integer) from anon;
grant execute on function public.add_merit(integer) to authenticated;

create or replace view public.merit_global
with (security_invoker = false)
as
select
  coalesce(sum(total), 0)::bigint as total,
  coalesce(sum(case when today_date = current_date then today_count else 0 end), 0)::bigint as today,
  count(*)::bigint as believers
from public.merit;

grant select on public.merit_global to anon, authenticated;
