-- =====================================================================
--  IBR Trading Cards — special packs are "pick one", plus a price/odds pass
--  Special packs (Tier A Elite, Podium, Team, Champion's Crate) roll their cards
--  and versions as usual, but you keep only the one you choose.
-- =====================================================================

alter table public.pack_types add column if not exists pick_one boolean not null default false;
update public.pack_types set pick_one = true where id in ('elite','podium','team','crate');

-- the rolled-but-not-yet-chosen cards. picked_at null = waiting for a choice
create table if not exists public.pending_picks (
  user_id    uuid primary key,
  pack       text not null,
  cards      jsonb not null,          -- [{"id":card id,"variant":variant id,"print_run":n|null}]
  made_at    timestamptz not null default now(),
  picked_at  timestamptz,
  picked     int
);
alter table public.pending_picks enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'pending_picks' and policyname = 'read own pick') then
    create policy "read own pick" on public.pending_picks for select using (user_id = auth.uid());
  end if;
end $$;
grant select on public.pending_picks to authenticated;

-- grant a card with a version decided beforehand
create or replace function priv.grant_fixed(p_user uuid, p_card text, p_variant text) returns jsonb
language plpgsql set search_path = public as $$
declare had boolean := priv.owns(p_user, p_card); m jsonb; t smallint;
begin
  if coalesce(p_variant, 'base') <> 'base' then m := priv.mint(p_user, p_card, p_variant); end if;
  if m is null then
    insert into user_cards (user_id, card_id, qty) values (p_user, p_card, 1)
    on conflict (user_id, card_id) do update set qty = user_cards.qty + 1;
    m := jsonb_build_object('variant', 'base');
  end if;
  select tier into t from cards where id = p_card;
  if coalesce(t, 0) >= 4 or (m->>'serial') is not null then
    insert into pull_log (user_id, card_id, tier, variant, serial, print_run)
    values (p_user, p_card, coalesce(t, 0), m->>'variant', (m->>'serial')::int, (m->>'print_run')::int);
  end if;
  return jsonb_build_object('id', p_card, 'is_new', not had) || m;
end $$;

create or replace function priv.grant_card(p_user uuid, p_card text, p_boost numeric) returns jsonb
language sql set search_path = public as $$
  select priv.grant_fixed(p_user, p_card, priv.roll_variant(p_boost))
$$;

create or replace function public._open(p_user uuid, p_type text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare got text[]; c text; out jsonb := '[]'; b numeric; j jsonb; po boolean; v text;
begin
  select variant_boost, pick_one into b, po from pack_types where id = p_type;
  if po and exists (select 1 from pending_picks where user_id = p_user and picked_at is null) then
    raise exception 'Choose your card from your last special pack first.';
  end if;
  update user_packs set qty = qty - 1 where user_id = p_user and pack = p_type and qty > 0;
  if not found then raise exception 'You don''t have that pack.'; end if;
  got := _roll(p_type);
  if po then
    foreach c in array got loop
      v := priv.roll_variant(b);
      out := out || jsonb_build_object('id', c, 'variant', v, 'is_new', not priv.owns(p_user, c),
                                       'print_run', (select print_run from variants where id = v));
    end loop;
    insert into pending_picks (user_id, pack, cards, made_at, picked_at, picked) values (p_user, p_type, out, now(), null, null)
    on conflict (user_id) do update set pack = excluded.pack, cards = excluded.cards, made_at = now(), picked_at = null, picked = null;
    update profiles set opened = opened + 1 where id = p_user;
    return jsonb_build_object('pick', true, 'pack', p_type, 'cards', out);
  end if;
  foreach c in array got loop
    j := priv.grant_card(p_user, c, b);
    if exists (select 1 from jsonb_array_elements(out) e where e->>'id' = c) then j := j || '{"is_new":false}'; end if;
    out := out || j;
  end loop;
  update profiles set opened = opened + 1 where id = p_user;
  return out;
end $$;

create or replace function public.pick_card(p_i int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := _me(); pp pending_picks; x jsonb;
begin
  select * into pp from pending_picks where user_id = u and picked_at is null for update;
  if not found then raise exception 'There''s no pack waiting for a choice.'; end if;
  x := pp.cards -> p_i;
  if x is null then raise exception 'Pick one of the cards shown.'; end if;
  update pending_picks set picked_at = now(), picked = p_i where user_id = u;
  return priv.grant_fixed(u, x->>'id', x->>'variant');
end $$;
grant execute on function public.pick_card(int) to authenticated;

-- ---------- price / odds pass ----------
update public.pack_types set price = 2500, description = 'Only drivers who race in a Tier A league. Pick 1 of 4.' where id = 'elite';
update public.pack_types set price = 5000, weights = '{0,20,42,28,8,2}', description = 'Only drivers with a podium. Epic or better guaranteed. Pick 1 of 3.' where id = 'podium';
update public.pack_types set price = 10000, weights = '{0,0,45,40,12,3}', description = 'Rare floor, one Legendary or better. Pick 1 of 3.' where id = 'crate';
update public.pack_types set price = 1500, guar = 1, weights = '{40,30,18,9,2.5,0.5}', description = 'Featured team of the week. Pick 1 of 3.' where id = 'team';
update public.pack_types set weights = '{38,32,19,8.5,2,0.5}' where id = 'premium';
update public.pack_types set weights = '{56,28,11.5,3.6,0.75,0.15}' where id = 'standard';

create or replace function public.tier_price(t integer) returns integer
language sql immutable set search_path = public as $$ select (array[150,400,900,3000,12000,45000])[t+1] $$;
