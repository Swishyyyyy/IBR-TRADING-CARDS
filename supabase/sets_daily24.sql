-- team sets count every current team a driver races for (5+ drivers); daily pack is a 24-hour cooldown
create or replace function public.set_reward(p_team text) returns int
language sql stable security definer set search_path = public as $$
  select (round(sum(tier_sell(tier)) * 1.5 / 10) * 10)::int from cards where active and p_team = any (teams)
$$;
create or replace function public.claim_set(p_team text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); n int; missing int; c int;
begin
  if coalesce(p_team, '') in ('', 'Independent', 'No Team') then raise exception 'That isn''t a team set.'; end if;
  select count(*) into n from cards where active and p_team = any (teams);
  if n < 5 then raise exception 'That team doesn''t have a set.'; end if;
  select count(*) into missing from cards c where c.active and p_team = any (c.teams) and not priv.owns(u, c.id);
  if missing > 0 then raise exception 'You still need % driver% from this set.', missing, case when missing = 1 then '' else 's' end; end if;
  c := set_reward(p_team);
  insert into set_claims (user_id, set_id, coins) values (u, 'team:' || p_team, c);
  update profiles set coins = coins + c where id = u;
  return jsonb_build_object('coins', c, 'drivers', n);
exception when unique_violation then raise exception 'You already claimed this set.';
end $$;
alter table public.profiles add column if not exists last_daily_at timestamptz;
create or replace function public.claim_daily() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); p profiles; s int; left_s int;
begin
  select * into p from profiles where id = u for update;
  if p.last_daily_at is not null and p.last_daily_at > now() - interval '24 hours' then
    left_s := floor(extract(epoch from (p.last_daily_at + interval '24 hours' - now())))::int;
    raise exception 'Your next Daily Pack is ready in %h %m.', left_s / 3600, (left_s % 3600) / 60;
  end if;
  s := case when p.last_daily_at > now() - interval '48 hours' then p.streak + 1 else 1 end;
  update profiles set streak = s, last_daily_at = now(), last_daily = current_date where id = u;
  perform _give_pack(u, 'daily');
  return jsonb_build_object('bonus', 0, 'streak', s, 'pack', true, 'next', now() + interval '24 hours');
end $$;
