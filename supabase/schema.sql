-- 敲木鱼：功德表、原子加功德（带限速）、全站统计
-- 在 Supabase Dashboard -> SQL Editor 中整段执行；可重复执行，旧库会自动升级
-- "今日"统一按北京时间（Asia/Shanghai）计算，与前端 todayKey() 保持一致

create table if not exists public.merit (
  user_id uuid primary key references auth.users (id) on delete cascade,
  total bigint not null default 0 check (total >= 0),
  today_date date not null default ((now() at time zone 'Asia/Shanghai')::date),
  today_count integer not null default 0 check (today_count >= 0),
  updated_at timestamptz not null default now(),
  bucket_tokens double precision not null default 3000,
  bucket_at timestamptz not null default now()
);

-- 旧库升级：补限速字段，日期默认值改为北京时间
alter table public.merit add column if not exists bucket_tokens double precision not null default 3000;
alter table public.merit add column if not exists bucket_at timestamptz not null default now();
alter table public.merit alter column today_date set default ((now() at time zone 'Asia/Shanghai')::date);

alter table public.merit enable row level security;

drop policy if exists "merit_select_own" on public.merit;
create policy "merit_select_own"
  on public.merit for select
  to authenticated
  using (auth.uid() = user_id);

grant select on public.merit to authenticated;

-- 返回列新增 accepted，签名变化需要先删除旧函数
drop function if exists public.add_merit(integer);

-- 令牌桶限速：每秒补充 15 点额度，最多攒 3000 点（约 3 分钟连续快敲）
-- 超出额度的部分直接丢弃（不报错），避免前端无限重试；accepted 为实际计入数
create function public.add_merit(n integer)
returns table (total bigint, today_count integer, accepted integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_rate constant double precision := 15;
  v_cap constant double precision := 3000;
  v_tokens double precision;
  v_ok integer;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if n is null or n < 1 or n > 500 then
    raise exception 'invalid amount';
  end if;

  insert into public.merit (user_id) values (uid)
  on conflict (user_id) do nothing;

  select least(
           v_cap,
           m.bucket_tokens + v_rate * extract(epoch from (now() - m.bucket_at))::double precision
         )
    into v_tokens
    from public.merit m
   where m.user_id = uid
     for update;

  v_ok := least(n::double precision, floor(v_tokens))::integer;

  update public.merit m set
    total = m.total + v_ok,
    today_count = case when m.today_date = v_today then m.today_count + v_ok else v_ok end,
    today_date = v_today,
    bucket_tokens = v_tokens - v_ok,
    bucket_at = now(),
    updated_at = now()
  where m.user_id = uid;

  return query
    select m.total, m.today_count, v_ok
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
  coalesce(sum(case
    when today_date = (now() at time zone 'Asia/Shanghai')::date then today_count
    else 0
  end), 0)::bigint as today,
  count(*)::bigint as believers
from public.merit;

grant select on public.merit_global to anon, authenticated;
