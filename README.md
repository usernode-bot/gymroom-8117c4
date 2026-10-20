# Gymroom

A Hyrox training log. Train the race: one screen does the job — pick a
station, log a set with its time, and see your fastest set for each week
alongside your full history.

- **Log a set.** Pick Running or one of the eight Hyrox stations in race
  order (1 SkiErg, 2 Sled push, 3 Sled pull, 4 Burpee broad jumps,
  5 Rowing, 6 Farmers carry, 7 Sandbag lunges, 8 Wall balls). In the race
  a 1 km run comes before each station, so every run is logged under
  Running. Type the time as m:ss (or bare seconds) and tap Log set; the
  time stays filled in, and picking a station fills it from your last set
  of that station. After a set is logged, an optional Rest 1:00 button
  runs a one minute countdown; the rest is not saved.
- **See your progress.** Per station: your fastest set ever, and the
  fastest set of every week you trained it, each compared with the week
  before — "Faster by", "Slower by", "Same as before" or "First week".
  Hyrox is a race, so the fastest time wins; a tie keeps the earlier set.
- **Look back.** Every set in one history, grouped by day, each reading
  as its time, with delete.

Sets logged against the old general exercise list, and sets logged before
this app became a pure timing log with a weight or reps instead of a time,
are kept in the database but no longer shown. One set at a time, each
person sees only their own sets. Progress is a list of weekly bests,
not a chart.

## Running it

- **Sign-in** — the server verifies the platform-issued user token
  (an RS256 JWT) on every request, so the app knows who is using it.
  No accounts to build.
- **Database** — the app has its own private Postgres database
  (`exercises` and `sets`, both `staging:private`), schema applied
  idempotently on boot. The `exercises` table is kept but unused; the
  stations are a fixed list in `server.js`.
- **Styling** — Tailwind CSS, precompiled by `npm run build` during
  image creation, in a light and a dark look that follow the viewer's
  Homeroom theme.
- **Staging demo** — on a staging preview, `?demo=1` shows six weeks of
  sample Hyrox training for the viewing account, labelled "Staging demo:
  sample Hyrox training".
