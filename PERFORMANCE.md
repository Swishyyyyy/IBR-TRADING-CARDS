# Page-load performance fixes

## The problem

The site showed "Loading the paddock…" for several seconds on every visit. The page
itself is small, but before it can draw anything the app has to download its data from
Supabase (cards, packs, leagues, races, tracks, auctions, players, and your own
collection).

Each request to Supabase takes about 0.3–0.8 s round trip. Requests that go out
**together** cost about one round trip in total. Requests that go out **one after another**
each add their own round trip. The old startup code had a long chain of them:

```
getSession
 └ 13 public tables (in parallel)       ← good
    └ event_teams                       ← waited for the 13
       └ player_skins                   ← waited for event_teams
          └ team_of_week                ← waited for player_skins
             └ settle_due → auctions, profiles/user_cards/specials → set_claims, pulls, sales
                └ YOUR data: profile, packs, cards, claims… (in parallel)
                   └ set_claims → pending_picks → wishlist → bug_reports → set_timezone
                      └ (admins) awards → diamond_meter → is_owner → bug_reports → ign_requests → admin_economy
                         └ notices
```

A signed-out visitor waited about **6 round trips**. A signed-in player waited about **11**,
and an admin about **17**.

## What changed

### 1. Startup data loads in parallel (`docs/app.js`, `docs/dev/app.js`)

- **`loadPublic()`**: `event_teams`, `player_skins`, `team_of_week` and the
  auctions/people/pulls/sales loaders now go out in the **same** `Promise.all` as the
  other public tables. None of them depended on each other.
- **`loadPeople()`**: `set_claims` now loads alongside profiles/user_cards/special_cards.
- **`loadMe()`**: `set_claims`, `pending_picks`, `wishlist`, `bug_reports` and `notices`
  join the first batch of player data. Admin-only data (awards, diamond meter, owner
  check, all bug reports, IGN requests, economy) loads as one parallel batch.
  `set_timezone` runs alongside it.
- **`boot()`**: public data and the player's own data now load **at the same time**
  (`Promise.allSettled`) instead of public first, then player. If one side fails, the
  other still loads and the error still shows as a toast, as before.
  In the dev build, duel data still loads after the player's data, since it needs it.

Error handling is unchanged: every request that used to fall back to an empty value on
failure still does. Only the timing changed.

New chain: **about 2 round trips for everyone** (settle_due → auctions is the only
remaining step that has to wait, because auctions must be settled before they're listed).

### 2. HTML loads faster (`docs/index.html`, `docs/dev/index.html`)

- **`preconnect`** hints for Supabase, jsDelivr and Google Fonts. The browser opens
  those connections (DNS + TLS) while it is still reading the HTML, instead of when the
  first request is made.
- **Google Fonts no longer block the first paint.** The font stylesheet loads in the
  background (`media="print" onload=…` pattern, plus `<noscript>` fallback). Text shows
  in the system font immediately and switches when the font arrives.
- **Scripts use `defer`.** They still download in parallel and run in the same order,
  after the page is parsed.
- Cache-busting versions bumped (`v=31 → v=32` live, `v=54 → v=55` dev) so browsers fetch
  the new `app.js` immediately.

### 3. three.js is lazy-loaded (dev build only)

The dev page loaded three.js (~600 KB) on every visit, even though only the 3D duel race
viewer uses it. It is now downloaded by `loadThree()` the first time a race is watched.
The download starts when the qualifying screen appears, so it is normally ready by the
time the countdown ends.

## Measured results

The same page on the same machine and network, signed out, from navigation start until
the page finished loading its data:

| Version   | Run 1  | Run 2  |
|-----------|--------|--------|
| Before    | 4.07 s | 3.23 s |
| After     | 1.20 s | 1.11 s |

That is about **3× faster** for visitors. Signed-in players and admins skip even more
waiting (about 9 and 15 round trips saved), so their improvement should be larger.
I could not measure that directly because it requires a Discord login.

## Ideas for later (not done here)

- **Long-lived caching for versioned files.** `vercel.json` sends
  `max-age=0, must-revalidate` for everything, so browsers re-check `app.js` and
  `styles.css` on every visit. Because these use `?v=` cache-busting, they could be
  cached for a year. This is safe only if the version number is bumped on every deploy.
- **`tracks` is the largest download (~200 KB)** because it includes every track's
  top-20 list. If the first screen doesn't need it, it could load after the first render.
- **`user_cards` for every player** is downloaded on startup for the rankings. As the
  player count grows, a server-side summary (RPC or view) would scale better.
