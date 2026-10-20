-- =====================================================================
--  Ice Lap Exchange — balance pass: league order inside tiers, lower race pay,
--  fewer packs, much rarer numbered cards. Run after variants.sql. Safe to re-run.
-- =====================================================================

-- league order inside a tier (1 = top). Each step down is worth 10% less.
alter table public.leagues add column if not exists tier_rank int not null default 1;
update public.leagues set tier_rank = case id
  when 'id-a-s13' then 1 when 'fc1-2026' then 2 when 'ibr-wc-2026' then 3
  when 'id-b-s13' then 1 when 'fc2-2026' then 2 else tier_rank end
 where id in ('id-a-s13','fc1-2026','ibr-wc-2026','id-b-s13','fc2-2026');

create or replace function public.league_factor(p_short text) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select greatest(0.7, 1 - 0.1 * (min(tier_rank) - 1)) from leagues where short = p_short), 1)
$$;

-- lower race pay
create or replace function public.race_reward(p_pos int, p_tier text) returns int language sql immutable as $$
  select (round(
    (case when p_pos <= 10 then (array[200,150,120,100,90,80,70,60,55,50])[p_pos]
          when p_pos <= 15 then 35 when p_pos <= 20 then 25 else 15 end)
    * (case p_tier when 'A' then 1.5 when 'B' then 1.2 when 'R' then 0.8 else 1 end) / 5) * 5)::int
$$;
-- packs only for the podium
create or replace function public.race_pack(p_pos int) returns text language sql immutable as $$
  select case when p_pos = 1 then 'gold' when p_pos <= 3 then 'silver' end
$$;

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
  c := (round(race_reward(ps, r.tier) * league_factor(r.league) / 5) * 5)::int;
  pk := race_pack(ps);
  insert into race_claims (user_id, race_id, pos, coins) values (u, p_race, ps, c);
  update profiles set coins = coins + c where id = u;
  if pk is not null then perform _give_pack(u, pk); end if;
  return jsonb_build_object('pos', ps, 'coins', c, 'pack', pk);
exception when unique_violation then raise exception 'Already claimed.';
end $$;

-- Track Pack only for a P1 time
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
  pack := ps = 1 and (prev is null or prev > 1);
  insert into track_claims (user_id, track_id, pos) values (u, p_track, ps)
  on conflict (user_id, track_id) do update set pos = excluded.pos, claimed_at = now();
  update profiles set coins = coins + due where id = u;
  if pack then perform _give_pack(u, 'track'); end if;
  return jsonb_build_object('pos', ps, 'coins', due, 'pack', pack);
end $$;

-- daily: tokens every day, a Daily Pack every 3rd day of a streak
create or replace function public.claim_daily() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); p profiles; bonus int; s int; pk boolean;
begin
  select * into p from profiles where id = u for update;
  if p.last_daily = current_date then raise exception 'You already claimed today.'; end if;
  s := case when p.last_daily = current_date - 1 then p.streak + 1 else 1 end;
  bonus := 150 + 30 * least(s - 1, 6);
  pk := s % 3 = 0;
  update profiles set streak = s, last_daily = current_date, coins = coins + bonus where id = u;
  if pk then perform _give_pack(u, 'daily'); end if;
  return jsonb_build_object('bonus', bonus, 'streak', s, 'pack', pk);
end $$;

-- smaller reward packs
update public.pack_types set cards = case id when 'daily' then 2 when 'gold' then 3 when 'silver' then 3
  when 'bronze' then 2 when 'finisher' then 2 when 'track' then 2 else cards end,
  description = case id when 'daily' then 'Every 3rd day of your streak.' when 'silver' then 'P2–P3 reward.'
  when 'track' then 'First P1 time on a BoatLabs track.' else description end
 where id in ('daily','gold','silver','bronze','finisher','track');

-- much rarer versions; Diamond 1/1 is about 1 in 50,000 cards
update public.variants set chance = case id when 'holo' then 0.04 when 'frost' then 0.01 when 'gold' then 0.003
  when 'aurora' then 0.0008 when 'blackice' then 0.0002 when 'diamond' then 0.00002 else chance end
 where id in ('holo','frost','gold','aurora','blackice','diamond');
update public.pack_types set variant_boost = case id when 'crate' then 1.5 when 'podium' then 1.3 when 'gold' then 1.3 else 1.15 end
 where variant_boost > 1;

grant execute on function public.league_factor(text) to anon, authenticated;
