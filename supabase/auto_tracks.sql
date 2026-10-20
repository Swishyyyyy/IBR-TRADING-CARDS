-- =====================================================================
--  Ice Lap Exchange — automatic BoatLabs leaderboard updates
--  Run once in Supabase → SQL Editor, after schema.sql.
--  Every 30 minutes the database checks the nightly leaderboard file on
--  GitHub and updates any track whose top 20 changed.
-- =====================================================================

create schema if not exists extensions;
do $$ begin
  begin create extension if not exists pg_net with schema extensions; exception when others then raise notice 'pg_net: %', sqlerrm; end;
  begin create extension if not exists pg_cron with schema pg_catalog; exception when others then
    begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron: %', sqlerrm; end;
  end;
end $$;

alter table public.site_config add column if not exists tracks_feed_url   text default 'https://raw.githubusercontent.com/Swishyyyyy/IBR-TRADING-CARDS/main/tracks.json';
alter table public.site_config add column if not exists tracks_feed_stamp text default '';
alter table public.site_config add column if not exists tracks_feed_req   bigint;
alter table public.site_config add column if not exists tracks_feed_checked timestamptz;
alter table public.site_config add column if not exists tracks_feed_status text default '';
update public.site_config set tracks_feed_url = 'https://raw.githubusercontent.com/Swishyyyyy/IBR-TRADING-CARDS/main/tracks.json'
 where id = 1 and (coalesce(tracks_feed_url, '') = '' or tracks_feed_url like '%ice-lap-tracks%');

-- Applies one downloaded tracks.json document. Returns how many tracks changed.
create or replace function public._apply_tracks_feed(doc jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if jsonb_typeof(doc->'tracks') <> 'array' then raise exception 'feed has no tracks array'; end if;
  with clean as (
    select t->>'id' as id, left(coalesce(t->>'name', t->>'id'), 80) as name,
      (select jsonb_agg(jsonb_build_object('pos', (e->>'pos')::int, 'mc', left(e->>'mc', 32), 'time', left(coalesce(e->>'time',''), 16))
                        order by (e->>'pos')::int)
         from jsonb_array_elements(t->'top') e
        where (e->>'pos') ~ '^\d{1,2}$' and (e->>'pos')::int between 1 and 20
          and coalesce(e->>'mc','') ~ '^[A-Za-z0-9_]{1,32}$') as top
    from jsonb_array_elements(doc->'tracks') t
    where coalesce(t->>'id','') ~ '^[A-Za-z0-9_.-]{1,80}$' and jsonb_typeof(t->'top') = 'array'
  )
  insert into tracks (id, name, server, url, top, updated_at)
  select id, name, 'BoatLabs', 'https://boatlabs.net/tracks/' || id, top, now() from clean where top is not null
  on conflict (id) do update set name = excluded.name, top = excluded.top, updated_at = now()
  where tracks.top is distinct from excluded.top or tracks.name is distinct from excluded.name;
  get diagnostics n = row_count;
  return n;
end $$;

-- Called every 30 minutes by pg_cron: apply the last download, then start a new one.
create or replace function public.sync_tracks_feed() returns text
language plpgsql security definer set search_path = public as $$
declare cfg site_config; resp record; doc jsonb; n int; msg text := 'waiting for first download';
begin
  select * into cfg from site_config where id = 1;
  if coalesce(cfg.tracks_feed_url, '') = '' then return 'no feed url'; end if;
  if cfg.tracks_feed_req is not null then
    select status_code, content, timed_out, error_msg into resp from net._http_response where id = cfg.tracks_feed_req;
    if not found then msg := 'download still running';
    elsif resp.status_code is distinct from 200 then msg := 'download failed: ' || coalesce(resp.status_code::text, resp.error_msg, 'timed out');
    else
      begin
        doc := resp.content::jsonb;
        if coalesce(doc->>'generated_at', '') <> '' and doc->>'generated_at' = cfg.tracks_feed_stamp then
          msg := 'no changes since ' || cfg.tracks_feed_stamp;
        else
          n := _apply_tracks_feed(doc);
          update site_config set tracks_feed_stamp = coalesce(doc->>'generated_at', '') where id = 1;
          msg := format('updated %s tracks from feed of %s', n, coalesce(doc->>'generated_at', 'unknown time'));
        end if;
      exception when others then msg := 'bad feed file: ' || sqlerrm;
      end;
    end if;
  end if;
  update site_config set
    tracks_feed_req = net.http_get(cfg.tracks_feed_url || '?v=' || floor(extract(epoch from now()))::bigint,
                                   timeout_milliseconds => 30000),
    tracks_feed_checked = now(), tracks_feed_status = msg
  where id = 1;
  return msg;
end $$;

-- Admin "Check now" button in League admin.
create or replace function public.admin_sync_tracks() returns text
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  return sync_tracks_feed();
end $$;

revoke execute on function public._apply_tracks_feed(jsonb), public.sync_tracks_feed() from public, anon, authenticated;

-- every 30 minutes, at :07 and :37
do $$ begin
  perform cron.schedule('ice-lap-sync-tracks', '7,37 * * * *', 'select public.sync_tracks_feed()');
exception when others then raise notice 'Could not schedule (enable pg_cron under Database → Extensions, then run this file again): %', sqlerrm;
end $$;

-- start the first download right away
select public.sync_tracks_feed();
