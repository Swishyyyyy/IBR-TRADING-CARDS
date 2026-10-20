-- =====================================================================
--  Ice Lap Exchange — database schema
--  Paste this whole file into Supabase → SQL Editor → New query → Run.
--  Safe to run once on a fresh project. Run seed.sql afterwards.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- reference data (admins edit, everyone reads) ----------

create table if not exists public.leagues (
  id          text primary key,
  name        text not null,
  short       text not null,
  server      text default '',
  tier        text not null check (tier in ('A','B','C','R')),
  season      text default '',
  url         text default '',
  rows        jsonb not null default '[]',   -- [[name, team, points, wins, podiums], ...]
  updated_at  timestamptz not null default now()
);

create table if not exists public.cards (
  id          text primary key,              -- driver name
  name        text not null,
  team        text default '',
  teams       text[] not null default '{}',
  tier        smallint not null check (tier between 0 and 5),
  ovr         smallint not null,
  rank        int not null,
  score       real not null default 0,
  wins        int not null default 0,
  pods        int not null default 0,
  best_tier   text default 'R',
  leagues     jsonb not null default '[]',
  active      boolean not null default true
);

create table if not exists public.races (
  id          text primary key default gen_random_uuid()::text,
  name        text not null,
  league      text default '',
  tier        text not null default 'C' check (tier in ('A','B','C','R')),
  date        date not null default current_date,
  results     jsonb not null default '[]',   -- [{pos, mc, pts?}, ...]
  source      text default '',
  posted_at   timestamptz not null default now()
);

create table if not exists public.tracks (
  id          text primary key,
  name        text not null,
  server      text not null default 'BoatLabs',
  url         text default '',
  top         jsonb not null default '[]',   -- [{pos, mc, time}, ...] up to 20
  updated_at  timestamptz not null default now()
);

create table if not exists public.pack_types (
  id          text primary key,
  name        text not null,
  price       int,                           -- null = not for sale
  cards       int not null,
  weights     numeric[] not null,            -- 6 values: Common..Mythic
  guar        smallint,                      -- last card at least this tier
  pool        text not null default 'all',   -- all | tierA | team | podium
  special     boolean not null default false,
  sort        int not null default 0,
  description text default '',
  c1          text default '#0a6a7e',
  c2          text default '#1aa3b8'
);

create table if not exists public.site_config (
  id          int primary key default 1 check (id = 1),
  discord_invite text default '',
  ign_note    text default ''
);
insert into public.site_config (id) values (1) on conflict do nothing;

-- ---------- players ----------

create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  discord_name  text not null default '',
  discord_handle text default '',
  avatar_url    text default '',
  ign           text,                        -- set only by an admin approving a request
  coins         int not null default 1000 check (coins >= 0),
  streak        int not null default 0,
  last_daily    date,
  opened        int not null default 0,
  is_admin      boolean not null default false,
  created_at    timestamptz not null default now()
);
create unique index if not exists profiles_ign_unique on public.profiles (lower(ign)) where ign is not null;

create table if not exists public.user_packs (
  user_id  uuid references public.profiles(id) on delete cascade,
  pack     text references public.pack_types(id),
  qty      int not null default 0 check (qty >= 0),
  primary key (user_id, pack)
);

create table if not exists public.user_cards (
  user_id  uuid references public.profiles(id) on delete cascade,
  card_id  text not null,
  qty      int not null default 0 check (qty >= 0),
  primary key (user_id, card_id)
);

create table if not exists public.ign_requests (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  ign        text not null,
  status     text not null default 'pending' check (status in ('pending','denied')),
  reason     text default '',
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table if not exists public.race_claims (
  user_id uuid references public.profiles(id) on delete cascade,
  race_id text references public.races(id) on delete cascade,
  pos int, coins int, claimed_at timestamptz default now(),
  primary key (user_id, race_id)
);

create table if not exists public.track_claims (
  user_id uuid references public.profiles(id) on delete cascade,
  track_id text references public.tracks(id) on delete cascade,
  pos int not null, claimed_at timestamptz default now(),
  primary key (user_id, track_id)
);

create table if not exists public.board_buys (
  user_id uuid references public.profiles(id) on delete cascade,
  day date not null, card_id text not null,
  primary key (user_id, day, card_id)
);

create table if not exists public.auctions (
  id           uuid primary key default gen_random_uuid(),
  seller       uuid not null references public.profiles(id) on delete cascade,
  card_id      text not null,
  start_bid    int not null check (start_bid > 0),
  buy_now      int not null default 0,
  high_bid     int not null default 0,
  high_bidder  uuid references public.profiles(id) on delete set null,
  bid_count    int not null default 0,
  status       text not null default 'open' check (status in ('open','sold','unsold','cancelled')),
  created_at   timestamptz not null default now(),
  ends_at      timestamptz not null,
  settled_at   timestamptz
);
create index if not exists auctions_status on public.auctions (status, ends_at);

-- ---------- helpers ----------

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false)
$$;

create or replace function public._me() returns uuid
language plpgsql stable as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  return auth.uid();
end $$;

create or replace function public.tier_price(t int) returns int language sql immutable as
$$ select (array[150,400,900,2400,7000,22000])[t+1] $$;
create or replace function public.tier_sell(t int) returns int language sql immutable as
$$ select (array[15,40,100,260,800,2500])[t+1] $$;

create or replace function public.race_reward(p_pos int, p_tier text) returns int language sql immutable as $$
  select (round(
    (case when p_pos <= 10 then (array[400,300,240,200,180,160,150,140,130,120])[p_pos]
          when p_pos <= 15 then 90 when p_pos <= 20 then 70 else 50 end)
    * (case p_tier when 'A' then 1.5 when 'B' then 1.2 when 'R' then 0.8 else 1 end) / 5) * 5)::int
$$;
create or replace function public.race_pack(p_pos int) returns text language sql immutable as $$
  select case when p_pos = 1 then 'gold' when p_pos <= 3 then 'silver' when p_pos <= 10 then 'bronze' else 'finisher' end
$$;
create or replace function public.track_reward(p_pos int) returns int language sql immutable as $$
  select case when p_pos is null or p_pos < 1 then 0 when p_pos = 1 then 300 when p_pos = 2 then 250 when p_pos = 3 then 210
              when p_pos <= 5 then 170 when p_pos <= 10 then 130 when p_pos <= 15 then 90 when p_pos <= 20 then 60 else 0 end
$$;

create or replace function public.team_of_week() returns text
language sql stable security definer set search_path = public as $$
  with t as (
    select team from (select unnest(teams) as team from cards where active) u
    group by team having count(*) >= 5 order by team
  ), n as (select count(*) c from t)
  select team from t offset (select case when c = 0 then 0 else ((floor(extract(epoch from now()) / 86400)::bigint + 3) / 7) % c end from n) limit 1
$$;

create or replace function public._pool(p_pool text) returns setof public.cards
language sql stable security definer set search_path = public as $$
  select * from cards c where c.active and case p_pool
    when 'tierA'  then c.best_tier = 'A'
    when 'team'   then team_of_week() = any (c.teams)
    when 'podium' then c.pods > 0
    else true end
$$;

create or replace function public._give_card(p_user uuid, p_card text, p_n int default 1) returns void
language sql security definer set search_path = public as $$
  insert into user_cards (user_id, card_id, qty) values (p_user, p_card, p_n)
  on conflict (user_id, card_id) do update set qty = user_cards.qty + excluded.qty
$$;

create or replace function public._give_pack(p_user uuid, p_pack text, p_n int default 1) returns void
language sql security definer set search_path = public as $$
  insert into user_packs (user_id, pack, qty) values (p_user, p_pack, p_n)
  on conflict (user_id, pack) do update set qty = user_packs.qty + excluded.qty
$$;

create or replace function public._roll(p_type text) returns text[]
language plpgsql volatile security definer set search_path = public as $$
declare pt pack_types; res text[] := '{}'; i int; mn int; w numeric[]; tot numeric; r numeric; t int; pick text;
begin
  select * into pt from pack_types where id = p_type;
  if not found then raise exception 'Unknown pack.'; end if;
  for i in 1..pt.cards loop
    mn := case when i = pt.cards and pt.guar is not null then pt.guar else 0 end;
    w := array[0,0,0,0,0,0]::numeric[]; tot := 0;
    for t in 0..5 loop
      if t >= mn and pt.weights[t+1] > 0 and exists (select 1 from _pool(pt.pool) c where c.tier = t) then
        w[t+1] := pt.weights[t+1]; tot := tot + w[t+1];
      end if;
    end loop;
    if tot = 0 then
      select max(tier) into t from _pool(pt.pool) c where c.tier >= mn;
      if t is null then select max(tier) into t from _pool(pt.pool); end if;
      if t is null then raise exception 'The card pool is empty.'; end if;
    else
      r := random() * tot; t := 0;
      while t < 5 and r >= w[t+1] loop r := r - w[t+1]; t := t + 1; end loop;
      while t > 0 and w[t+1] = 0 loop t := t - 1; end loop;
    end if;
    select id into pick from _pool(pt.pool) c where c.tier = t order by random() limit 1;
    res := res || pick;
  end loop;
  return res;
end $$;

-- opens one pack the user already holds; returns [{id, is_new}]
create or replace function public._open(p_user uuid, p_type text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare got text[]; c text; out jsonb := '[]'; seen text[] := '{}'; had boolean;
begin
  update user_packs set qty = qty - 1 where user_id = p_user and pack = p_type and qty > 0;
  if not found then raise exception 'You don''t have that pack.'; end if;
  got := _roll(p_type);
  foreach c in array got loop
    had := c = any(seen) or exists (select 1 from user_cards where user_id = p_user and card_id = c and qty > 0);
    perform _give_card(p_user, c);
    seen := seen || c;
    out := out || jsonb_build_object('id', c, 'is_new', not had);
  end loop;
  update profiles set opened = opened + 1 where id = p_user;
  delete from user_packs where user_id = p_user and qty = 0;
  return out;
end $$;

-- ---------- player actions (all called with supabase.rpc) ----------

create or replace function public.open_pack(p_type text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin return _open(_me(), p_type); end $$;

create or replace function public.buy_pack(p_type text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pr int;
begin
  select price into pr from pack_types where id = p_type;
  if pr is null then raise exception 'That pack isn''t for sale.'; end if;
  if not exists (select 1 from _pool((select pool from pack_types where id = p_type))) then raise exception 'That pack''s pool is empty right now.'; end if;
  update profiles set coins = coins - pr where id = u and coins >= pr;
  if not found then raise exception 'Not enough tokens.'; end if;
  perform _give_pack(u, p_type);
  return _open(u, p_type);
end $$;

create or replace function public.claim_daily() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); p profiles; bonus int; s int;
begin
  select * into p from profiles where id = u for update;
  if p.last_daily = current_date then raise exception 'You already claimed today''s pack.'; end if;
  s := case when p.last_daily = current_date - 1 then p.streak + 1 else 1 end;
  bonus := 150 + 30 * least(s - 1, 6);
  update profiles set streak = s, last_daily = current_date, coins = coins + bonus where id = u;
  perform _give_pack(u, 'daily');
  return jsonb_build_object('bonus', bonus, 'streak', s);
end $$;

create or replace function public.get_board() returns table (card_id text, tier int, price int)
language sql stable security definer set search_path = public as $$
  select x.id, t, (round(tier_price(t) * 1.4 / 10) * 10)::int
  from generate_series(0,5) t
  cross join lateral (select id from cards where active and cards.tier = t order by md5(id || current_date::text) limit 1) x
$$;

create or replace function public.buy_board(p_card text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pr int; had boolean;
begin
  select price into pr from get_board() where card_id = p_card;
  if pr is null then raise exception 'That card isn''t on today''s board.'; end if;
  if exists (select 1 from board_buys where user_id = u and day = current_date and card_id = p_card) then raise exception 'You already bought that one today.'; end if;
  update profiles set coins = coins - pr where id = u and coins >= pr;
  if not found then raise exception 'Not enough tokens.'; end if;
  had := exists (select 1 from user_cards where user_id = u and card_id = p_card and qty > 0);
  insert into board_buys values (u, current_date, p_card);
  perform _give_card(u, p_card);
  return jsonb_build_array(jsonb_build_object('id', p_card, 'is_new', not had));
end $$;

create or replace function public.buy_tier(p_tier int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pr int := tier_price(p_tier); pick text; had boolean;
begin
  if p_tier not between 0 and 5 then raise exception 'Unknown rarity.'; end if;
  select id into pick from cards where active and tier = p_tier order by random() limit 1;
  if pick is null then raise exception 'No drivers at that rarity right now.'; end if;
  update profiles set coins = coins - pr where id = u and coins >= pr;
  if not found then raise exception 'Not enough tokens.'; end if;
  had := exists (select 1 from user_cards where user_id = u and card_id = pick and qty > 0);
  perform _give_card(u, pick);
  return jsonb_build_array(jsonb_build_object('id', pick, 'is_new', not had));
end $$;

create or replace function public.quick_sell(p_card text, p_n int default 1) returns int
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); t int; v int;
begin
  if p_n < 1 then raise exception 'Nothing to sell.'; end if;
  select tier into t from cards where id = p_card;
  update user_cards set qty = qty - p_n where user_id = u and card_id = p_card and qty >= p_n;
  if not found then raise exception 'You don''t have that many.'; end if;
  delete from user_cards where user_id = u and qty = 0;
  v := tier_sell(coalesce(t, 0)) * p_n;
  update profiles set coins = coins + v where id = u;
  return v;
end $$;

-- ---------- auctions ----------

create or replace function public._settle(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a auctions;
begin
  select * into a from auctions where id = p_id for update;
  if a.status <> 'open' or a.ends_at > now() then return; end if;
  if a.high_bidder is not null then
    perform _give_card(a.high_bidder, a.card_id);
    update profiles set coins = coins + floor(a.high_bid * 0.95)::int where id = a.seller;
    update auctions set status = 'sold', settled_at = now() where id = p_id;
  else
    perform _give_card(a.seller, a.card_id);
    update auctions set status = 'unsold', settled_at = now() where id = p_id;
  end if;
end $$;

create or replace function public.settle_due() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from auctions where status = 'open' and ends_at <= now() limit 50 loop
    perform _settle(r.id); n := n + 1;
  end loop;
  delete from auctions where status <> 'open' and coalesce(settled_at, created_at) < now() - interval '14 days';
  return n;
end $$;

create or replace function public.list_auction(p_card text, p_start int, p_buy_now int, p_hours int) returns uuid
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); nid uuid;
begin
  if p_hours not in (1, 6, 24, 72) then raise exception 'Pick 1, 6, 24 or 72 hours.'; end if;
  if p_start < 1 then raise exception 'The starting bid must be at least 1.'; end if;
  if coalesce(p_buy_now, 0) > 0 and p_buy_now <= p_start then raise exception 'Buy-now must be higher than the starting bid.'; end if;
  if (select count(*) from auctions where seller = u and status = 'open') >= 10 then raise exception 'You can have 10 live listings at a time.'; end if;
  update user_cards set qty = qty - 1 where user_id = u and card_id = p_card and qty >= 1;
  if not found then raise exception 'You don''t own that card.'; end if;
  delete from user_cards where user_id = u and qty = 0;
  insert into auctions (seller, card_id, start_bid, buy_now, ends_at)
  values (u, p_card, p_start, coalesce(p_buy_now, 0), now() + make_interval(hours => p_hours)) returning id into nid;
  return nid;
end $$;

create or replace function public.cancel_auction(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); a auctions;
begin
  select * into a from auctions where id = p_id for update;
  if a.seller is distinct from u then raise exception 'That isn''t your listing.'; end if;
  if a.status <> 'open' or a.high_bidder is not null then raise exception 'This listing already has a bid or has ended.'; end if;
  perform _give_card(u, a.card_id);
  update auctions set status = 'cancelled', settled_at = now() where id = p_id;
end $$;

create or replace function public.place_bid(p_id uuid, p_amount int, p_buy_now boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); a auctions; amt int := p_amount; mn int; sold boolean := false;
begin
  select * into a from auctions where id = p_id for update;
  if not found or a.status <> 'open' or a.ends_at <= now() then raise exception 'This auction has ended.'; end if;
  if a.seller = u then raise exception 'You can''t bid on your own listing.'; end if;
  if p_buy_now then
    if a.buy_now <= 0 then raise exception 'No buy-now price on this listing.'; end if;
    amt := a.buy_now;
  end if;
  mn := case when a.high_bid > 0 then greatest(a.high_bid + 1, ceil(a.high_bid * 1.05)::int) else a.start_bid end;
  if amt < mn then raise exception 'The minimum bid is %.', mn; end if;
  if a.buy_now > 0 and amt >= a.buy_now then amt := a.buy_now; sold := true; end if;
  update profiles set coins = coins - amt where id = u and coins >= amt;
  if not found then raise exception 'Not enough tokens for that bid.'; end if;
  if a.high_bidder is not null then
    update profiles set coins = coins + a.high_bid where id = a.high_bidder;  -- refund the previous top bid
  end if;
  update auctions set high_bid = amt, high_bidder = u, bid_count = bid_count + 1,
    ends_at = case when sold then now() else greatest(ends_at, now() + interval '30 seconds') end
  where id = p_id;
  if sold then perform _settle(p_id); return 'bought'; end if;
  return 'leading';
end $$;

-- ---------- IGN approval ----------

create or replace function public.request_ign(p_ign text) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); g text := trim(p_ign);
begin
  if g !~ '^[A-Za-z0-9_]{3,16}$' then raise exception 'Minecraft IGNs are 3–16 letters, numbers or underscores.'; end if;
  if exists (select 1 from profiles where lower(ign) = lower(g) and id <> u) then raise exception 'That IGN is already approved for another Discord account. Contact the league admin if it''s yours.'; end if;
  if exists (select 1 from profiles where id = u and lower(ign) = lower(g)) then raise exception 'That IGN is already approved for you.'; end if;
  insert into ign_requests (user_id, ign) values (u, g)
  on conflict (user_id) do update set ign = excluded.ign, status = 'pending', reason = '', created_at = now(), decided_at = null;
end $$;

create or replace function public.decide_ign(p_user uuid, p_ok boolean, p_reason text default '') returns void
language plpgsql security definer set search_path = public as $$
declare r ign_requests;
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  select * into r from ign_requests where user_id = p_user for update;
  if not found then raise exception 'That request is gone.'; end if;
  if p_ok then
    if exists (select 1 from profiles where lower(ign) = lower(r.ign) and id <> p_user) then
      raise exception 'That IGN is already approved for someone else. Revoke theirs first.';
    end if;
    update profiles set ign = r.ign where id = p_user;
    delete from ign_requests where user_id = p_user;
  else
    update ign_requests set status = 'denied', reason = left(coalesce(p_reason, ''), 200), decided_at = now() where user_id = p_user;
  end if;
end $$;

create or replace function public.revoke_ign(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  update profiles set ign = null where id = p_user;
end $$;

-- ---------- rewards ----------

create or replace function public.claim_race(p_race text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); g text; r races; ps int; c int; pk text;
begin
  select ign into g from profiles where id = u;
  if g is null then raise exception 'Get your IGN approved first.'; end if;
  select * into r from races where id = p_race;
  if not found then raise exception 'Unknown race.'; end if;
  select min((x->>'pos')::int) into ps from jsonb_array_elements(r.results) x where lower(x->>'mc') = lower(g);
  if ps is null then raise exception 'You''re not in this race''s results.'; end if;
  c := race_reward(ps, r.tier); pk := race_pack(ps);
  insert into race_claims (user_id, race_id, pos, coins) values (u, p_race, ps, c);   -- PK blocks double claims
  update profiles set coins = coins + c where id = u;
  perform _give_pack(u, pk);
  return jsonb_build_object('pos', ps, 'coins', c, 'pack', pk);
exception when unique_violation then raise exception 'Already claimed.';
end $$;

create or replace function public.claim_track(p_track text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); g text; t tracks; ps int; prev int; due int; pack boolean;
begin
  select ign into g from profiles where id = u;
  if g is null then raise exception 'Get your IGN approved first.'; end if;
  select * into t from tracks where id = p_track;
  if not found then raise exception 'Unknown track.'; end if;
  select min((x->>'pos')::int) into ps from jsonb_array_elements(t.top) x where lower(x->>'mc') = lower(g);
  if ps is null then raise exception 'You''re not in this track''s top 20.'; end if;
  select pos into prev from track_claims where user_id = u and track_id = p_track for update;
  if prev is not null and ps >= prev then raise exception 'Already claimed at P%.', prev; end if;
  due := track_reward(ps) - track_reward(prev);
  pack := ps <= 3 and (prev is null or prev > 3);
  insert into track_claims (user_id, track_id, pos) values (u, p_track, ps)
  on conflict (user_id, track_id) do update set pos = excluded.pos, claimed_at = now();
  update profiles set coins = coins + due where id = u;
  if pack then perform _give_pack(u, 'track'); end if;
  return jsonb_build_object('pos', ps, 'coins', due, 'pack', pack);
end $$;

create or replace function public.claim_all() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); g text; r record; nr int := 0; nt int := 0; total int := 0; j jsonb;
begin
  select ign into g from profiles where id = u;
  if g is null then raise exception 'Get your IGN approved first.'; end if;
  for r in select id from races where exists (select 1 from jsonb_array_elements(results) x where lower(x->>'mc') = lower(g))
           and not exists (select 1 from race_claims c where c.user_id = u and c.race_id = races.id) loop
    j := claim_race(r.id); nr := nr + 1; total := total + (j->>'coins')::int;
  end loop;
  for r in select t.id, (select min((x->>'pos')::int) from jsonb_array_elements(t.top) x where lower(x->>'mc') = lower(g)) ps
           from tracks t loop
    if r.ps is not null and not exists (select 1 from track_claims c where c.user_id = u and c.track_id = r.id and c.pos <= r.ps) then
      j := claim_track(r.id); nt := nt + 1; total := total + (j->>'coins')::int;
    end if;
  end loop;
  return jsonb_build_object('races', nr, 'tracks', nt, 'coins', total);
end $$;

-- ---------- admin: rebuild the card pool from league standings ----------

create or replace function public.admin_set_catalog(p_cards jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  update cards set active = false;
  insert into cards (id, name, team, teams, tier, ovr, rank, score, wins, pods, best_tier, leagues, active)
  select x->>'id', x->>'name', coalesce(x->>'team',''),
         coalesce((select array_agg(v) from jsonb_array_elements_text(x->'teams') v), '{}'),
         (x->>'tier')::smallint, (x->>'ovr')::smallint, (x->>'rank')::int, (x->>'score')::real,
         (x->>'wins')::int, (x->>'pods')::int, coalesce(x->>'best_tier','R'), coalesce(x->'leagues','[]'), true
  from jsonb_array_elements(p_cards) x
  on conflict (id) do update set name = excluded.name, team = excluded.team, teams = excluded.teams, tier = excluded.tier,
    ovr = excluded.ovr, rank = excluded.rank, score = excluded.score, wins = excluded.wins, pods = excluded.pods,
    best_tier = excluded.best_tier, leagues = excluded.leagues, active = true;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- new Discord sign-ins get a profile + starter kit ----------

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}');
begin
  insert into profiles (id, discord_name, discord_handle, avatar_url)
  values (new.id,
          coalesce(m->'custom_claims'->>'global_name', m->>'full_name', m->>'name', 'Racer'),
          coalesce(m->>'full_name', m->>'name', ''),
          coalesce(m->>'avatar_url', ''))
  on conflict (id) do nothing;
  insert into user_packs (user_id, pack, qty) values (new.id, 'starter', 1) on conflict do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- row-level security ----------

alter table public.leagues      enable row level security;
alter table public.cards        enable row level security;
alter table public.races        enable row level security;
alter table public.tracks       enable row level security;
alter table public.pack_types   enable row level security;
alter table public.site_config  enable row level security;
alter table public.profiles     enable row level security;
alter table public.user_packs   enable row level security;
alter table public.user_cards   enable row level security;
alter table public.ign_requests enable row level security;
alter table public.race_claims  enable row level security;
alter table public.track_claims enable row level security;
alter table public.board_buys   enable row level security;
alter table public.auctions     enable row level security;

do $$
declare t text;
begin
  -- public reference data: everyone reads, admins write
  foreach t in array array['leagues','races','tracks','pack_types','site_config','cards'] loop
    execute format('drop policy if exists "read %1$s" on public.%1$I', t);
    execute format('create policy "read %1$s" on public.%1$I for select using (true)', t);
    execute format('drop policy if exists "admin write %1$s" on public.%1$I', t);
    execute format('create policy "admin write %1$s" on public.%1$I for all using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
  -- player data: everyone reads (leaderboards, auction names); writes only through the functions above
  foreach t in array array['profiles','user_cards','user_packs','auctions'] loop
    execute format('drop policy if exists "read %1$s" on public.%1$I', t);
    execute format('create policy "read %1$s" on public.%1$I for select using (true)', t);
  end loop;
  -- private per-player rows
  foreach t in array array['race_claims','track_claims','board_buys'] loop
    execute format('drop policy if exists "own %1$s" on public.%1$I', t);
    execute format('create policy "own %1$s" on public.%1$I for select using (user_id = auth.uid() or public.is_admin())', t);
  end loop;
end $$;

drop policy if exists "own or admin requests" on public.ign_requests;
create policy "own or admin requests" on public.ign_requests for select using (user_id = auth.uid() or public.is_admin());

-- functions run as their owner; only expose the public ones
revoke execute on function public._give_card(uuid,text,int), public._give_pack(uuid,text,int), public._roll(text),
  public._open(uuid,text), public._settle(uuid) from public, anon, authenticated;

-- live updates for the auction house and the admin queue
do $$ begin
  begin alter publication supabase_realtime add table public.auctions; exception when others then null; end;
  begin alter publication supabase_realtime add table public.ign_requests; exception when others then null; end;
  begin alter publication supabase_realtime add table public.profiles; exception when others then null; end;
end $$;

-- ---------- pack definitions ----------

insert into public.pack_types (id, name, price, cards, weights, guar, pool, special, sort, description, c1, c2) values
 ('starter',  'Starter Kit',      null, 6, '{50,28,14,6,1.6,0.4}', 2, 'all',    false, 0,  'Welcome pack. Six cards, last one Rare or better.', '#0a6a7e','#1aa3b8'),
 ('daily',    'Daily Pack',       null, 3, '{60,25,10,4,0.9,0.1}', null,'all',  false, 1,  'Free once a day.', '#2d7f9a','#64c2d4'),
 ('standard', 'Standard Pack',    500,  4, '{55,27,12,4.5,1.2,0.3}',1, 'all',    false, 10, 'Four cards, one Uncommon or better.', '#3d5a73','#7b9bb5'),
 ('premium',  'Premium Pack',     1500, 5, '{35,30,20,11,3.3,0.7}', 2, 'all',    false, 11, 'Five cards, one Rare or better.', '#2b3f9c','#5b7bea'),
 ('elite',    'Tier A Elite',     2200, 4, '{30,30,22,13,4,1}',     2, 'tierA',  true,  20, 'Only drivers who race in a Tier A league.', '#9c2a1b','#e2603f'),
 ('team',     'Team Pack',        1200, 3, '{40,30,18,9,2.5,0.5}',  1, 'team',   true,  21, 'Featured team of the week.', '#8a5a00','#e0a52c'),
 ('podium',   'Podium Pack',      3500, 3, '{0,10,30,40,16,4}',     3, 'podium', true,  22, 'Only drivers with a podium. One Epic or better.', '#6b6f7a','#d6d9df'),
 ('crate',    'Champion''s Crate',8000, 3, '{0,0,40,40,16,4}',      4, 'all',    true,  23, 'Rare floor. One Legendary or better.', '#5b2a9c','#1aa3b8'),
 ('gold',     'Gold Race Pack',   null, 5, '{30,30,22,13,4,1}',     4, 'all',    false, 30, 'Race winner reward.', '#9b6c00','#ffd166'),
 ('silver',   'Silver Race Pack', null, 5, '{35,30,20,11,3.3,0.7}', 3, 'all',    false, 31, 'P2–P3 reward.', '#5d6670','#c9d2db'),
 ('bronze',   'Bronze Race Pack', null, 4, '{45,30,16,7,1.6,0.4}',  2, 'all',    false, 32, 'P4–P10 reward.', '#7a4320','#d08b56'),
 ('finisher', 'Finisher Pack',    null, 3, '{55,27,12,4.5,1.2,0.3}',1, 'all',    false, 33, 'Classified finish reward.', '#2f5d50','#62a892'),
 ('track',    'Track Pack',       null, 3, '{30,30,22,13,4,1}',     2, 'all',    false, 34, 'First top-3 time on a BoatLabs track.', '#0b3d4a','#ff6b4f')
on conflict (id) do update set name = excluded.name, price = excluded.price, cards = excluded.cards, weights = excluded.weights,
  guar = excluded.guar, pool = excluded.pool, special = excluded.special, sort = excluded.sort, description = excluded.description,
  c1 = excluded.c1, c2 = excluded.c2;

-- ---------- API access (row-level security above still decides what each person can do) ----------
grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
grant insert, update, delete on public.leagues, public.races, public.tracks, public.site_config, public.cards, public.pack_types to authenticated;
grant execute on function public.get_board(), public.team_of_week(), public.settle_due(), public.is_admin() to anon, authenticated;
grant execute on function public.open_pack(text), public.buy_pack(text), public.claim_daily(), public.buy_board(text), public.buy_tier(int),
  public.quick_sell(text,int), public.list_auction(text,int,int,int), public.cancel_auction(uuid), public.place_bid(uuid,int,boolean),
  public.request_ign(text), public.decide_ign(uuid,boolean,text), public.revoke_ign(uuid), public.claim_race(text), public.claim_track(text),
  public.claim_all(), public.admin_set_catalog(jsonb) to authenticated;
