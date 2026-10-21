-- =====================================================================
--  IBR Trading Cards — dupe trade-in, profile showcase, team set rewards
-- =====================================================================

-- ---------- 1. trade in 5 duplicates for 1 card of the next rarity ----------
create or replace function public.trade_in(p_tier int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); need int := 5; r record; take int; pick text; spare int;
begin
  if p_tier not between 0 and 4 then raise exception 'Pick Common through Legendary.'; end if;
  select coalesce(sum(uc.qty - 1), 0) into spare from user_cards uc join cards c on c.id = uc.card_id
   where uc.user_id = u and c.tier = p_tier and uc.qty > 1;
  if spare < need then raise exception 'You need 5 duplicates of that rarity (you have %).', spare; end if;
  select id into pick from cards where active and tier = p_tier + 1 order by random() limit 1;
  if pick is null then raise exception 'No drivers at the next rarity right now.'; end if;
  -- use up the most-duplicated cards first, always keeping one of each
  for r in select uc.card_id, uc.qty - 1 as extra from user_cards uc join cards c on c.id = uc.card_id
            where uc.user_id = u and c.tier = p_tier and uc.qty > 1 order by uc.qty desc, uc.card_id loop
    exit when need = 0;
    take := least(need, r.extra);
    update user_cards set qty = qty - take where user_id = u and card_id = r.card_id;
    need := need - take;
  end loop;
  return jsonb_build_array(priv.grant_card(u, pick, 1));
end $$;

-- ---------- 2. profile showcase: pin up to 3 cards ----------
alter table public.profiles add column if not exists showcase jsonb not null default '[]';

-- items: [{"k":"b","id":"<card id>"} | {"k":"s","id":<special card id>}]
create or replace function public.set_showcase(p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); x jsonb; out jsonb := '[]';
begin
  if jsonb_typeof(p_items) <> 'array' then raise exception 'Bad showcase.'; end if;
  for x in select * from jsonb_array_elements(p_items) limit 3 loop
    if x->>'k' = 's' then
      if not exists (select 1 from special_cards where id = (x->>'id')::bigint and owner = u) then raise exception 'You don''t own that card.'; end if;
      out := out || jsonb_build_object('k', 's', 'id', (x->>'id')::bigint);
    else
      if not exists (select 1 from user_cards where user_id = u and card_id = x->>'id' and qty > 0) then raise exception 'You don''t own that card.'; end if;
      out := out || jsonb_build_object('k', 'b', 'id', x->>'id');
    end if;
  end loop;
  update profiles set showcase = out where id = u;
  return out;
end $$;

-- ---------- 3. team sets ----------
create table if not exists public.set_claims (
  user_id   uuid references public.profiles(id) on delete cascade,
  set_id    text not null,
  coins     int not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, set_id)
);
alter table public.set_claims enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'set_claims' and policyname = 'read set_claims') then
    create policy "read set_claims" on public.set_claims for select using (true);
  end if;
end $$;
grant select on public.set_claims to anon, authenticated;

-- a set is every active driver whose main team is that team (teams with 3+ drivers)
create or replace function public.set_reward(p_team text) returns int
language sql stable security definer set search_path = public as $$
  select (round(sum(tier_sell(tier)) * 1.5 / 10) * 10)::int from cards where active and team = p_team
$$;

create or replace function public.claim_set(p_team text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); n int; missing int; c int;
begin
  if coalesce(p_team, '') in ('', 'Independent', 'No Team') then raise exception 'That isn''t a team set.'; end if;
  select count(*) into n from cards where active and team = p_team;
  if n < 3 then raise exception 'That team doesn''t have a set.'; end if;
  select count(*) into missing from cards c where c.active and c.team = p_team and not priv.owns(u, c.id);
  if missing > 0 then raise exception 'You still need % driver% from this set.', missing, case when missing = 1 then '' else 's' end; end if;
  c := set_reward(p_team);
  insert into set_claims (user_id, set_id, coins) values (u, 'team:' || p_team, c);
  update profiles set coins = coins + c where id = u;
  return jsonb_build_object('coins', c, 'drivers', n);
exception when unique_violation then raise exception 'You already claimed this set.';
end $$;

grant execute on function public.trade_in(int), public.set_showcase(jsonb), public.claim_set(text) to authenticated;
grant execute on function public.set_reward(text) to anon, authenticated;
