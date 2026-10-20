-- =====================================================================
--  Ice Lap Exchange — renamed players + card variants and numbered prints
--  Run after schema.sql. Safe to run again.
-- =====================================================================

-- ---------- renamed players ----------
-- Every name a driver has raced under points at their permanent Minecraft UUID.
-- league = '*' applies everywhere; a league id only applies to that league's standings
-- (needed when an old name was later taken by someone else).
create table if not exists public.players (
  uuid       text primary key,
  current    text not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.player_names (
  league text not null default '*',
  name   text not null,                -- lower case
  uuid   text not null,
  primary key (league, name)
);
alter table public.cards add column if not exists uuid text;
alter table public.cards add column if not exists aliases text[] not null default '{}';

-- ---------- variants ----------
create table if not exists public.variants (
  id         text primary key,
  name       text not null,
  print_run  int,                      -- null = unnumbered
  chance     numeric not null,         -- per card, before the pack's boost
  sell_mult  numeric not null,
  sort       int not null,
  blurb      text default ''
);
insert into public.variants (id, name, print_run, chance, sell_mult, sort, blurb) values
 ('base',     'Base',      null, 0,      1,  0, 'The standard card.'),
 ('holo',     'Holo',      null, 0.08,   2,  1, 'Rainbow foil. Unnumbered.'),
 ('frost',    'Frost',     50,   0.03,   4,  2, 'Numbered out of 50.'),
 ('gold',     'Gold',      21,   0.012,  8,  3, 'Numbered out of 21.'),
 ('aurora',   'Aurora',    10,   0.005,  15, 4, 'Numbered out of 10.'),
 ('blackice', 'Black Ice', 5,    0.002,  30, 5, 'Numbered out of 5.'),
 ('diamond',  'Diamond',   1,    0.0008, 80, 6, 'One of one. Only a single copy will ever exist.')
on conflict (id) do update set name = excluded.name, print_run = excluded.print_run, chance = excluded.chance,
  sell_mult = excluded.sell_mult, sort = excluded.sort, blurb = excluded.blurb;

alter table public.pack_types add column if not exists variant_boost numeric not null default 1;
update public.pack_types set variant_boost = case id
  when 'crate' then 2.5 when 'podium' then 2 when 'gold' then 2 when 'elite' then 1.5 when 'premium' then 1.5
  when 'track' then 1.5 when 'silver' then 1.5 else 1 end;

-- Every Holo or numbered card is its own row, so serial numbers are never reused,
-- even after a card is quick-sold.
create table if not exists public.special_cards (
  id         bigserial primary key,
  card_id    text not null,
  variant    text not null references public.variants(id),
  serial     int,
  print_run  int,
  owner      uuid references public.profiles(id) on delete set null,
  status     text not null default 'owned' check (status in ('owned','auction','retired')),
  pulled_by  uuid,
  pulled_at  timestamptz not null default now()
);
create unique index if not exists special_cards_serial on public.special_cards (card_id, variant, serial) where serial is not null;
create index if not exists special_cards_owner on public.special_cards (owner);

alter table public.auctions add column if not exists special_id bigint references public.special_cards(id);

-- ---------- internal helpers (private schema: not reachable from the website) ----------
create schema if not exists priv;

create or replace function priv.roll_variant(p_boost numeric) returns text
language plpgsql volatile set search_path = public as $$
declare r numeric := random(); v record; acc numeric := 0;
begin
  for v in select id, chance from variants where id <> 'base' order by sort desc loop
    acc := acc + v.chance * coalesce(p_boost, 1);
    if r < acc then return v.id; end if;
  end loop;
  return 'base';
end $$;

-- Creates one Holo/numbered copy. If every serial of that variant is taken,
-- it steps down to the next rarer-to-commoner variant (Holo never runs out).
create or replace function priv.mint(p_user uuid, p_card text, p_variant text) returns jsonb
language plpgsql volatile set search_path = public as $$
declare v variants; s int; nid bigint; tries int := 0;
begin
  select * into v from variants where id = p_variant;
  loop
    if v.id is null or v.id = 'base' then return null; end if;
    if v.print_run is null then
      insert into special_cards (card_id, variant, owner, pulled_by) values (p_card, v.id, p_user, p_user) returning id into nid;
      return jsonb_build_object('sid', nid, 'variant', v.id);
    end if;
    select g into s from generate_series(1, v.print_run) g
     where not exists (select 1 from special_cards x where x.card_id = p_card and x.variant = v.id and x.serial = g)
     order by random() limit 1;
    if s is not null then
      begin
        insert into special_cards (card_id, variant, serial, print_run, owner, pulled_by)
        values (p_card, v.id, s, v.print_run, p_user, p_user) returning id into nid;
        return jsonb_build_object('sid', nid, 'variant', v.id, 'serial', s, 'print_run', v.print_run);
      exception when unique_violation then
        tries := tries + 1; if tries < 5 then continue; end if;
      end;
    end if;
    select * into v from variants where sort < v.sort order by sort desc limit 1;   -- sold out: step down
  end loop;
end $$;

create or replace function priv.owns(p_user uuid, p_card text) returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from user_cards where user_id = p_user and card_id = p_card and qty > 0)
      or exists (select 1 from special_cards where owner = p_user and card_id = p_card)
$$;

-- Gives one card, rolling for a variant. Returns what the reveal screen shows.
create or replace function priv.grant_card(p_user uuid, p_card text, p_boost numeric) returns jsonb
language plpgsql volatile set search_path = public as $$
declare had boolean := priv.owns(p_user, p_card); v text := priv.roll_variant(p_boost); m jsonb;
begin
  if v <> 'base' then m := priv.mint(p_user, p_card, v); end if;
  if m is null then
    insert into user_cards (user_id, card_id, qty) values (p_user, p_card, 1)
    on conflict (user_id, card_id) do update set qty = user_cards.qty + 1;
    m := jsonb_build_object('variant', 'base');
  end if;
  return jsonb_build_object('id', p_card, 'is_new', not had) || m;
end $$;

-- Names a racer has used, for matching race results and track times to an approved IGN.
create or replace function priv.names_for(p_ign text) returns text[]
language sql stable set search_path = public as $$
  with u as (
    select uuid from players where lower(current) = lower(p_ign)
    union
    select uuid from player_names where name = lower(p_ign) and league = '*'
      and not exists (select 1 from players where lower(current) = lower(p_ign))
  )
  select array_agg(distinct n) from (
    select lower(p_ign) n
    union select pn.name from player_names pn join u using (uuid)
    union select lower(p.current) from players p join u using (uuid)
  ) x
$$;

create or replace function priv.set_catalog(p_cards jsonb) returns int
language plpgsql set search_path = public as $$
declare n int;
begin
  update cards set active = false where active;
  insert into cards (id, name, team, teams, tier, ovr, rank, score, wins, pods, best_tier, leagues, uuid, aliases, active)
  select x->>'id', x->>'name', coalesce(x->>'team',''),
         coalesce((select array_agg(v) from jsonb_array_elements_text(x->'teams') v), '{}'),
         (x->>'tier')::smallint, (x->>'ovr')::smallint, (x->>'rank')::int, (x->>'score')::real,
         (x->>'wins')::int, (x->>'pods')::int, coalesce(x->>'best_tier','R'), coalesce(x->'leagues','[]'),
         nullif(x->>'uuid',''), coalesce((select array_agg(v) from jsonb_array_elements_text(x->'aliases') v), '{}'), true
  from jsonb_array_elements(p_cards) x
  on conflict (id) do update set name = excluded.name, team = excluded.team, teams = excluded.teams, tier = excluded.tier,
    ovr = excluded.ovr, rank = excluded.rank, score = excluded.score, wins = excluded.wins, pods = excluded.pods,
    best_tier = excluded.best_tier, leagues = excluded.leagues, uuid = excluded.uuid, aliases = excluded.aliases, active = true;
  get diagnostics n = row_count;
  -- cards someone already owns under an old name follow the driver to the new card
  insert into user_cards (user_id, card_id, qty)
    select uc.user_id, c.id, uc.qty from user_cards uc join cards c on c.active and lower(uc.card_id) = any (c.aliases) and uc.card_id <> c.id
     where uc.qty > 0
  on conflict (user_id, card_id) do update set qty = user_cards.qty + excluded.qty;
  update user_cards uc set qty = 0 from cards c
   where c.active and lower(uc.card_id) = any (c.aliases) and uc.card_id <> c.id and uc.qty > 0;
  update special_cards s set card_id = c.id from cards c
   where c.active and lower(s.card_id) = any (c.aliases) and s.card_id <> c.id
     and not exists (select 1 from special_cards y where y.card_id = c.id and y.variant = s.variant and y.serial = s.serial);
  update auctions a set card_id = c.id from cards c
   where c.active and lower(a.card_id) = any (c.aliases) and a.card_id <> c.id;
  return n;
end $$;

-- ---------- updated game functions ----------

create or replace function public._open(p_user uuid, p_type text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare got text[]; c text; out jsonb := '[]'; b numeric; j jsonb;
begin
  update user_packs set qty = qty - 1 where user_id = p_user and pack = p_type and qty > 0;
  if not found then raise exception 'You don''t have that pack.'; end if;
  select variant_boost into b from pack_types where id = p_type;
  got := _roll(p_type);
  foreach c in array got loop
    j := priv.grant_card(p_user, c, b);
    if exists (select 1 from jsonb_array_elements(out) e where e->>'id' = c) then j := j || '{"is_new":false}'; end if;
    out := out || j;
  end loop;
  update profiles set opened = opened + 1 where id = p_user;
  return out;
end $$;

create or replace function public.buy_board(p_card text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pr int;
begin
  select price into pr from get_board() where card_id = p_card;
  if pr is null then raise exception 'That card isn''t on today''s board.'; end if;
  if exists (select 1 from board_buys where user_id = u and day = current_date and card_id = p_card) then raise exception 'You already bought that one today.'; end if;
  update profiles set coins = coins - pr where id = u and coins >= pr;
  if not found then raise exception 'Not enough tokens.'; end if;
  insert into board_buys values (u, current_date, p_card);
  return jsonb_build_array(priv.grant_card(u, p_card, 1));
end $$;

create or replace function public.buy_tier(p_tier int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pr int := tier_price(p_tier); pick text;
begin
  if p_tier not between 0 and 5 then raise exception 'Unknown rarity.'; end if;
  select id into pick from cards where active and tier = p_tier order by random() limit 1;
  if pick is null then raise exception 'No drivers at that rarity right now.'; end if;
  update profiles set coins = coins - pr where id = u and coins >= pr;
  if not found then raise exception 'Not enough tokens.'; end if;
  return jsonb_build_array(priv.grant_card(u, pick, 1));
end $$;

create or replace function public.quick_sell_special(p_id bigint) returns int
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); s special_cards; v int;
begin
  select * into s from special_cards where id = p_id for update;
  if s.owner is distinct from u or s.status <> 'owned' then raise exception 'You don''t own that card.'; end if;
  select (tier_sell(coalesce(c.tier, 0)) * vr.sell_mult)::int into v
    from variants vr left join cards c on c.id = s.card_id where vr.id = s.variant;
  update special_cards set owner = null, status = 'retired' where id = p_id;
  update profiles set coins = coins + v where id = u;
  return v;
end $$;

create or replace function public.list_special(p_id bigint, p_start int, p_buy_now int, p_hours int) returns uuid
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); s special_cards; nid uuid;
begin
  if p_hours not in (1, 6, 24, 72) then raise exception 'Pick 1, 6, 24 or 72 hours.'; end if;
  if p_start < 1 then raise exception 'The starting bid must be at least 1.'; end if;
  if coalesce(p_buy_now, 0) > 0 and p_buy_now <= p_start then raise exception 'Buy-now must be higher than the starting bid.'; end if;
  if (select count(*) from auctions where seller = u and status = 'open') >= 10 then raise exception 'You can have 10 live listings at a time.'; end if;
  select * into s from special_cards where id = p_id for update;
  if s.owner is distinct from u or s.status <> 'owned' then raise exception 'You don''t own that card.'; end if;
  update special_cards set status = 'auction' where id = p_id;
  insert into auctions (seller, card_id, special_id, start_bid, buy_now, ends_at)
  values (u, s.card_id, p_id, p_start, coalesce(p_buy_now, 0), now() + make_interval(hours => p_hours)) returning id into nid;
  return nid;
end $$;

create or replace function public._settle(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a auctions;
begin
  select * into a from auctions where id = p_id for update;
  if a.status <> 'open' or a.ends_at > now() then return; end if;
  if a.high_bidder is not null then
    if a.special_id is not null then update special_cards set owner = a.high_bidder, status = 'owned' where id = a.special_id;
    else perform _give_card(a.high_bidder, a.card_id); end if;
    update profiles set coins = coins + floor(a.high_bid * 0.95)::int where id = a.seller;
    update auctions set status = 'sold', settled_at = now() where id = p_id;
  else
    if a.special_id is not null then update special_cards set status = 'owned' where id = a.special_id;
    else perform _give_card(a.seller, a.card_id); end if;
    update auctions set status = 'unsold', settled_at = now() where id = p_id;
  end if;
end $$;

create or replace function public.cancel_auction(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); a auctions;
begin
  select * into a from auctions where id = p_id for update;
  if a.seller is distinct from u then raise exception 'That isn''t your listing.'; end if;
  if a.status <> 'open' or a.high_bidder is not null then raise exception 'This listing already has a bid or has ended.'; end if;
  if a.special_id is not null then update special_cards set status = 'owned' where id = a.special_id;
  else perform _give_card(u, a.card_id); end if;
  update auctions set status = 'cancelled', settled_at = now() where id = p_id;
end $$;

-- rewards follow renamed racers
create or replace function public.claim_race(p_race text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); g text; nm text[]; r races; ps int; c int; pk text;
begin
  select ign into g from profiles where id = u;
  if g is null then raise exception 'Get your IGN approved first.'; end if;
  nm := priv.names_for(g);
  select * into r from races where id = p_race;
  if not found then raise exception 'Unknown race.'; end if;
  select min((x->>'pos')::int) into ps from jsonb_array_elements(r.results) x where lower(x->>'mc') = any (nm);
  if ps is null then raise exception 'You''re not in this race''s results.'; end if;
  c := race_reward(ps, r.tier); pk := race_pack(ps);
  insert into race_claims (user_id, race_id, pos, coins) values (u, p_race, ps, c);
  update profiles set coins = coins + c where id = u;
  perform _give_pack(u, pk);
  return jsonb_build_object('pos', ps, 'coins', c, 'pack', pk);
exception when unique_violation then raise exception 'Already claimed.';
end $$;

create or replace function public.claim_track(p_track text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); g text; nm text[]; t tracks; ps int; prev int; due int; pack boolean;
begin
  select ign into g from profiles where id = u;
  if g is null then raise exception 'Get your IGN approved first.'; end if;
  nm := priv.names_for(g);
  select * into t from tracks where id = p_track;
  if not found then raise exception 'Unknown track.'; end if;
  select min((x->>'pos')::int) into ps from jsonb_array_elements(t.top) x where lower(x->>'mc') = any (nm);
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
declare u uuid := _me(); g text; nm text[]; r record; nr int := 0; nt int := 0; total int := 0; j jsonb;
begin
  select ign into g from profiles where id = u;
  if g is null then raise exception 'Get your IGN approved first.'; end if;
  nm := priv.names_for(g);
  for r in select id from races where exists (select 1 from jsonb_array_elements(results) x where lower(x->>'mc') = any (nm))
           and not exists (select 1 from race_claims c where c.user_id = u and c.race_id = races.id) loop
    j := claim_race(r.id); nr := nr + 1; total := total + (j->>'coins')::int;
  end loop;
  for r in select t.id, (select min((x->>'pos')::int) from jsonb_array_elements(t.top) x where lower(x->>'mc') = any (nm)) ps
           from tracks t loop
    if r.ps is not null and not exists (select 1 from track_claims c where c.user_id = u and c.track_id = r.id and c.pos <= r.ps) then
      j := claim_track(r.id); nt := nt + 1; total := total + (j->>'coins')::int;
    end if;
  end loop;
  return jsonb_build_object('races', nr, 'tracks', nt, 'coins', total);
end $$;

create or replace function public.admin_set_catalog(p_cards jsonb) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  return priv.set_catalog(p_cards);
end $$;

-- Admin: "these two names are the same racer"
create or replace function public.admin_merge_names(p_old text, p_current text) returns text
language plpgsql security definer set search_path = public as $$
declare o text := lower(trim(p_old)); c text := trim(p_current); id text;
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  if o !~ '^[a-z0-9_]{1,16}$' or c !~ '^[A-Za-z0-9_]{1,16}$' then raise exception 'Use Minecraft names (letters, numbers, underscores).'; end if;
  if o = lower(c) then raise exception 'Those are the same name.'; end if;
  select uuid into id from players where lower(current) = lower(c);
  if id is null then select uuid into id from player_names where league = '*' and name = lower(c); end if;
  if id is null then id := 'manual:' || lower(c); end if;
  insert into players (uuid, current) values (id, c) on conflict (uuid) do update set current = excluded.current, updated_at = now();
  insert into player_names (league, name, uuid) values ('*', lower(c), id), ('*', o, id)
  on conflict (league, name) do update set uuid = excluded.uuid;
  return id;
end $$;

-- ---------- access ----------
alter table public.players       enable row level security;
alter table public.player_names  enable row level security;
alter table public.variants      enable row level security;
alter table public.special_cards enable row level security;
do $$
declare t text;
begin
  foreach t in array array['players','player_names','variants'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'read ' || t) then
      execute format('create policy "read %1$s" on public.%1$I for select using (true)', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'admin write ' || t) then
      execute format('create policy "admin write %1$s" on public.%1$I for all using (public.is_admin()) with check (public.is_admin())', t);
    end if;
  end loop;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'special_cards' and policyname = 'read special_cards') then
    create policy "read special_cards" on public.special_cards for select using (true);
  end if;
  begin alter publication supabase_realtime add table public.special_cards; exception when others then null; end;
end $$;

grant select on public.players, public.player_names, public.variants, public.special_cards to anon, authenticated;
grant insert, update on public.players, public.player_names, public.variants to authenticated;
grant execute on function public.quick_sell_special(bigint), public.list_special(bigint,int,int,int),
  public.admin_merge_names(text,text) to authenticated;
