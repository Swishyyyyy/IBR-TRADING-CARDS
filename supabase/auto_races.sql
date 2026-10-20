-- =====================================================================
--  Ice Lap Exchange — automatic race results (boatstats FC + IceDrifters)
--  Every 30 minutes the database works through a small download queue.
--  Once a day (after midnight New York time) it re-reads each league's race list
--  and downloads any race it hasn't imported yet. Safe to run again.
-- =====================================================================

alter table public.races add column if not exists ext_id text;
create unique index if not exists races_ext_id on public.races (ext_id) where ext_id is not null;

create table if not exists public.race_sources (
  league   text primary key,              -- league short code, e.g. FC1
  kind     text not null check (kind in ('boatstats','icedrifters')),
  url      text not null,
  active   boolean not null default true
);
alter table public.race_sources enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'race_sources' and policyname = 'read race_sources') then
    create policy "read race_sources" on public.race_sources for select using (true);
    create policy "admin write race_sources" on public.race_sources for all using (public.is_admin()) with check (public.is_admin());
  end if;
end $$;
grant select on public.race_sources to anon, authenticated;
grant insert, update on public.race_sources to authenticated;

insert into public.race_sources (league, kind, url) values
 ('FC1','boatstats','https://boatstats.app/en/leagues/formula-craft-1?season=cmmi6vvdj03pponjd2hf7y337&tab=races'),
 ('FC2','boatstats','https://boatstats.app/en/leagues/formula-craft-2?season=cmmi9mi8304a9onjduq7vah3o&tab=races'),
 ('IDA','icedrifters','https://icedrifters.de/leagues/001_League_A/01_public/15_results.php'),
 ('IDB','icedrifters','https://icedrifters.de/leagues/002_League_B/01_public/15_results.php'),
 ('IDC','icedrifters','https://icedrifters.de/leagues/003_League_C/01_public/15_results.php'),
 ('IDR','icedrifters','https://icedrifters.de/leagues/004_League_R/01_public/15_results.php')
on conflict (league) do nothing;

create table if not exists priv.race_jobs (
  req       bigint primary key,
  kind      text not null,                 -- index_bs | index_id | race_bs | race_id
  league    text not null,
  ref       jsonb not null default '{}',
  made_at   timestamptz not null default now(),
  done_at   timestamptz,
  note      text default ''
);

alter table public.site_config add column if not exists races_feed_checked timestamptz;
alter table public.site_config add column if not exists races_feed_status text default '';
alter table public.site_config add column if not exists races_index_at timestamptz;

-- ---------- parsers (pure functions on the downloaded HTML) ----------

create or replace function priv.parse_bs_index(h text) returns text[]
language sql immutable as $$
  select coalesce(array_agg(distinct m[1]), '{}') from regexp_matches(h, '/races/([a-z0-9]{20,32})"', 'g') m
$$;

create or replace function priv.parse_bs_race(h text) returns jsonb
language plpgsql immutable as $$
declare nm text; d text[]; trk text; body text; res jsonb; p int;
begin
  nm := (regexp_match(h, '<span>([^<]{1,80})</span></h1>'))[1];
  d := regexp_match(h, '>(\d{1,2})/(\d{1,2})/(\d{4})<');
  trk := (regexp_match(h, '</h1><div[^>]*><span[^>]*>([^<]{1,60})</span>'))[1];
  p := strpos(h, '-->FINAL<');
  body := case when p > 0 then substr(h, p) else h end;
  select jsonb_agg(jsonb_build_object('pos', pos, 'mc', mc) order by pos) into res from (
    select distinct on (pos) pos, mc from (
      select (m[1])::int pos, m[2] mc, row_number() over () rn
      from regexp_matches(body, 'P<!-- -->(\d{1,3})</span></div><a [^>]*href="/[a-z]{2}/driver/[0-9a-f-]+"><img [^>]*alt="([A-Za-z0-9_]{1,16})"', 'g') m
    ) x order by pos, rn
  ) y;
  return jsonb_build_object('name', coalesce(nm, 'Race'), 'track', trk,
    'date', case when d is null then null else make_date(d[3]::int, d[1]::int, d[2]::int) end,
    'completed', strpos(h, '>Completed<') > 0, 'results', coalesce(res, '[]'));
end $$;

create or replace function priv.parse_id_index(h text) returns jsonb
language plpgsql immutable as $$
declare season int; sel text; out jsonb;
begin
  season := (regexp_match(h, 'value="(\d+)"\s*selected\s*>\s*Season'))[1]::int;
  sel := substring(h from strpos(h, 'name="filter_id"'));
  sel := substring(sel from 1 for greatest(strpos(sel, '</select>'), 1));
  select jsonb_agg(jsonb_build_object('fid', m[1]::int, 'num', m[2]::int)) into out
    from regexp_matches(sel, 'value="(\d+)"[^>]*>\s*Race:\s*(\d+)', 'g') m;
  return jsonb_build_object('season', season, 'races', coalesce(out, '[]'));
end $$;

create or replace function priv.parse_id_race(h text) returns jsonb
language sql immutable as $$
  with rows as (
    select row_number() over () rn, (select array_agg(trim(c[1])) from regexp_matches(r[1], '<td[^>]*>([^<]*)</td>', 'g') c) cells
    from regexp_matches(h, '<tr>(.*?)</tr>', 'g') r
  ), clean as (
    select rn, cells[1] pos_txt, cells[2] mc, nullif(regexp_replace(coalesce(cells[10], ''), '[^0-9.-]', '', 'g'), '')::numeric pts
    from rows where cells is not null and array_length(cells, 1) >= 10 and cells[1] ~ '^\d{1,3}$' and cells[2] ~ '^[A-Za-z0-9_]{1,16}$'
  )
  select coalesce(jsonb_agg(jsonb_build_object('pos', p, 'mc', mc, 'pts', pts) order by p), '[]') from (
    select row_number() over (order by coalesce(pts, -1) desc, pos_txt::int, rn) p, mc, pts from clean
  ) z
$$;

-- ---------- the queue worker ----------

create or replace function priv.sync_races(p_force boolean default false) returns text
language plpgsql set search_path = public as $$
declare j record; resp record; doc jsonb; info jsonb; r record; rid text; t text; n_new int := 0; n_queued int := 0;
        msg text; cfg site_config; budget int := 12;
begin
  -- 1. handle finished downloads
  for j in select * from priv.race_jobs where done_at is null order by made_at limit 40 loop
    select status_code, content into resp from net._http_response where id = j.req;
    if not found then
      if j.made_at < now() - interval '2 hours' then update priv.race_jobs set done_at = now(), note = 'lost' where req = j.req; end if;
      continue;
    end if;
    if resp.status_code is distinct from 200 then
      update priv.race_jobs set done_at = now(), note = 'http ' || coalesce(resp.status_code::text, '?') where req = j.req; continue;
    end if;
    begin
      if j.kind = 'index_bs' then
        foreach rid in array priv.parse_bs_index(resp.content) loop
          if not exists (select 1 from races where ext_id = 'bs:' || rid)
             and not exists (select 1 from priv.race_jobs where kind = 'race_bs' and ref->>'id' = rid and (done_at is null or done_at > now() - interval '20 hours')) then
            insert into priv.race_jobs (req, kind, league, ref)
            values (net.http_get(regexp_replace(j.ref->>'url', '\?.*$', '') || '/races/' || rid, timeout_milliseconds => 30000), 'race_bs', j.league, jsonb_build_object('id', rid));
            n_queued := n_queued + 1;
          end if;
        end loop;
      elsif j.kind = 'index_id' then
        info := priv.parse_id_index(resp.content);
        for r in select (x->>'fid')::int fid, (x->>'num')::int num from jsonb_array_elements(info->'races') x loop
          rid := lower(j.league) || '-s' || (info->>'season') || '-r' || lpad(r.num::text, 2, '0');
          if (info->>'season') is not null and not exists (select 1 from races where id = rid)
             and not exists (select 1 from priv.race_jobs where kind = 'race_id' and ref->>'rid' = rid and (done_at is null or done_at > now() - interval '20 hours')) then
            insert into priv.race_jobs (req, kind, league, ref)
            values (net.http_get(j.ref->>'url' || '?filter_season=' || (info->>'season') || '&filter_id=' || r.fid, timeout_milliseconds => 30000),
                    'race_id', j.league, jsonb_build_object('rid', rid, 'num', r.num, 'season', info->>'season'));
            n_queued := n_queued + 1;
          end if;
        end loop;
      elsif j.kind = 'race_bs' then
        doc := priv.parse_bs_race(resp.content);
        if (doc->>'completed')::boolean and jsonb_array_length(doc->'results') >= 3 then
          select tier into t from leagues where short = j.league order by tier_rank limit 1;
          -- a race already listed by name (from the first import) gets its full results instead of a duplicate
          update races set results = doc->'results', ext_id = 'bs:' || (j.ref->>'id'), source = 'BoatStats'
           where ext_id is null and league = j.league and lower(name) = lower(doc->>'name');
          if not found then
            insert into races (id, name, league, tier, date, results, source, ext_id)
            values ('bs-' || (j.ref->>'id'), left(doc->>'name', 80), j.league, coalesce(t, 'C'), coalesce((doc->>'date')::date, current_date),
                    doc->'results', 'BoatStats', 'bs:' || (j.ref->>'id'))
            on conflict do nothing;
          end if;
          n_new := n_new + 1;
        end if;
      elsif j.kind = 'race_id' then
        doc := priv.parse_id_race(resp.content);
        if jsonb_array_length(doc) >= 3 then
          select tier into t from leagues where short = j.league order by tier_rank limit 1;
          insert into races (id, name, league, tier, date, results, source, ext_id)
          values (j.ref->>'rid', 'R' || lpad(j.ref->>'num', 2, '0') || ' · Season ' || (j.ref->>'season'), j.league, coalesce(t, 'C'),
                  current_date, doc, 'icedrifters.de', 'id:' || (j.ref->>'rid'))
          on conflict do nothing;
          if found then n_new := n_new + 1; end if;
        end if;
      end if;
      update priv.race_jobs set done_at = now(), note = 'ok' where req = j.req;
    exception when others then
      update priv.race_jobs set done_at = now(), note = left('error: ' || sqlerrm, 200) where req = j.req;
    end;
  end loop;

  -- 2. once a day (or when forced) re-read every league's race list
  select * into cfg from site_config where id = 1;
  if p_force or cfg.races_index_at is null or cfg.races_index_at < now() - interval '20 hours' then
    for r in select * from race_sources where active loop
      insert into priv.race_jobs (req, kind, league, ref)
      values (net.http_get(r.url, timeout_milliseconds => 30000),
              case r.kind when 'boatstats' then 'index_bs' else 'index_id' end, r.league, jsonb_build_object('url', r.url));
    end loop;
    update site_config set races_index_at = now() where id = 1;
  end if;

  msg := format('%s new race%s imported, %s download%s queued', n_new, case when n_new = 1 then '' else 's' end,
                n_queued, case when n_queued = 1 then '' else 's' end);
  update site_config set races_feed_checked = now(),
    races_feed_status = case when n_new > 0 or n_queued > 0 or coalesce(races_feed_status, '') = '' then msg else races_feed_status end
  where id = 1;
  return msg;
end $$;

create or replace function public.admin_sync_races() returns text
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  return priv.sync_races(true);
end $$;
grant execute on function public.admin_sync_races() to authenticated;

do $$ begin
  perform cron.schedule('ice-lap-sync-races', '12,42 * * * *', 'select priv.sync_races()');
exception when others then raise notice 'Could not schedule: %', sqlerrm;
end $$;
