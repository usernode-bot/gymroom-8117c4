# Gymroom

A Hyrox training log. Train the race: one screen does the job — pick a
station, log a set with its weight, reps and time, and see your best set
for each week alongside your full history.

- **Log a set.** Pick Running or one of the eight Hyrox stations in race
  order (1 SkiErg, 2 Sled push, 3 Sled pull, 4 Burpee broad jumps,
  5 Rowing, 6 Farmers carry, 7 Sandbag lunges, 8 Wall balls). In the race
  a 1 km run comes before each station, so every run is logged under
  Running. Fill in any of Weight, Reps and Time and tap Log set; the
  fields keep their values, and picking a station fills them in from your
  last set of it.
- **See your progress.** Per station: your best set ever — drawn as the
  plates it takes to load a 20 kg bar for the weighted stations — and the
  best set of every week you trained it, each compared with the week
  before. Heavier wins, and for timed work faster wins: a time-only best
  is the fastest set, and the weeks read "Faster by" or "Slower by".
- **Look back.** Every set in one history, grouped by day, with delete.

Sets logged against the old general exercise list are kept in the
database but no longer shown. Weight is in kilograms, one set at a time,
each person sees only their own sets. Progress is a list of weekly bests,
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
