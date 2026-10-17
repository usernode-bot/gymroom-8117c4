# Gymroom

Log your workouts and watch your progress grow. One screen does the job:
pick an exercise, log a set with its weight, reps and time, and see your
best set for each week alongside your full history.

- **Log a set.** Pick from the starter list (squat, bench press, deadlift,
  overhead press, barbell row, pull-up, push-up, plank) or add your own.
  Fill in any of Weight, Reps and Time and tap Log set. The fields keep
  their values, and picking an exercise fills them in from your last set
  of it.
- **See your progress.** Per exercise: your best set ever, drawn as the
  plates it takes to load a 20 kg bar, and the best set of every week you
  trained it, each compared with the week before.
- **Look back.** Every set in one history, grouped by day, with delete.

Weight is in kilograms, one set at a time, each person sees only their own
sets. Progress is a list of weekly bests, not a chart.

## Running it

- **Sign-in** — the server verifies the platform-issued user token
  (an RS256 JWT) on every request, so the app knows who is using it.
  No accounts to build.
- **Database** — the app has its own private Postgres database
  (`exercises` and `sets`, both `staging:private`), schema applied
  idempotently on boot.
- **Styling** — Tailwind CSS, precompiled by `npm run build` during
  image creation, in a light and a dark look that follow the viewer's
  Homeroom theme.
- **Staging demo** — on a staging preview, `?demo=1` shows five weeks of
  sample training for the viewing account, labelled "Staging demo: sample
  workouts".
