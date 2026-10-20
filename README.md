# IBR Trading Cards — track feed

Nightly top-20 leaderboards for every [BoatLabs](https://boatlabs.net/tracks) track, used by **Ice Lap Exchange** to pay out track rewards.

- `tracks.json`: the current leaderboards. The Ice Lap Exchange database downloads this every 30 minutes and updates any track that changed.
- `tracks_list.txt`: every known track ID (from the BoatLabs sitemap). New tracks found in the sitemap are added nightly.
- `scan.txt`: the raw results of the last scan.
- `build.py`: turns `scan.txt` into `tracks.json`. Tracks that fail to load keep their previous leaderboard, and the script refuses to write if a scan looks broken.

Updated every night at 12:00 AM Eastern.
