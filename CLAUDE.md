# Gymroom — notes for Claude Code

This app runs on **Homeroom**. The platform conventions are the single
source of truth for platform-wide behavior (auth model, `USERNODE_ENV`,
public/private tables, "don't `git push`", etc.):

**Platform conventions (authoritative, always current):**
https://app.onhomeroom.com/claude.md

**Inside Homeroom** (its dev chat, and Homeroom bot's builds), do not
fetch that URL: what applies to your change is already in your
instructions, and the `homeroom` MCP server's
`get_platform_conventions` reads any one section of the conventions
when you need it. The two sections below are for working outside
Homeroom; skip them there.

**Anywhere else** (Claude Code run against this repo locally, or another
harness), fetch it at the start of each session. The hosted copy is
updated in place when platform rules change, so fetching it gives you
today's rules, not a stale snapshot.

## Connector permission prompts (outside Homeroom)

This repo ships `.claude/settings.json`, which allows the **read-only**
Homeroom connector calls (`mcp__homeroom__get_*`,
`…__list_*`, `…__whoami`) once you accept the workspace trust dialog.
See `.claude/README.md` for the whole story, including what to do if you
are still being prompted.

## Check that this checkout is current

You may be working in a fork of this app whose `main` is behind the app's
canonical repository, and nothing in the checkout says so: `git fetch origin`
compares the fork with itself. This matters before you **read** code to answer
a question about how the app behaves now, not only before you edit it.

The canonical repository is named in `.claude/homeroom-canonical-repo`. Check against
it, not against `origin`:

```sh
git fetch "$(cat .claude/homeroom-canonical-repo)" main
git merge-base --is-ancestor FETCH_HEAD HEAD && echo current || echo behind
```

`behind` means this checkout does not contain the canonical `main`. To answer
a question, read the canonical code instead (`git show FETCH_HEAD:<path>`,
`git grep <pattern> FETCH_HEAD`). To change code, start from the exact base
commit your Homeroom work order gives, and never merge or rebase onto the
canonical `main` yourself: which commit a change is diffed against decides
what the group votes on. With the Homeroom connector, `get_checkout_status`
answers the same question.

A session-start hook (`.claude/hooks/homeroom-freshness.sh`, see `.claude/README.md`) runs
this check for you and tells you when you are behind. It is silent offline, so
its silence is not proof the checkout is current. Inside Homeroom (its dev
chat, and Homeroom bot's builds) the platform fixes the base commit, and none
of this applies.

## Starter template

The screen this app currently ships — the "Starter template" hero with
the app's thumbnail tile and the plain-English note on how the app gets
built (by asking Homeroom bot) — is placeholder content from the
Homeroom starter template, not product intent.

When the user asks for their first real feature, REPLACE the template
screen rather than building alongside it:

- remove the `usernode-starter-notice@1` block in `public/index.html`
  (both sentinel comments and everything between them),
- rewrite `README.md` to describe the actual app.

Keep the `usernode-dev-console@1` forwarder `<script>` when rewriting the
HTML — that block is platform infrastructure, not template content. So is
the bridge `<script>`. The design kit is not placeholder either: build the
real app with it, and fill in "## Design" below.

The screen has a light and a dark look and follows the viewer's Homeroom
theme, switching live when they change it: the theme `<script>` right after
the bridge tag sets a `dark` class on `<html>`. Keep that script, and give
everything you build both looks (the design kit's colour tokens carry both), unless one
fixed look is the point of this app, like a game's own scene; then say so
under "## Design" below. Unless a request asks for one, add
no theme picker: the viewer's Homeroom setting is the control. "The
platform's light/dark theme inside the app frame" in the platform
conventions has the details.

If a rule below this line conflicts with the hosted conventions, the
hosted conventions win. This file is **app-specific** — write down
things about *this* app that belong in the repo: product intent,
data-model quirks, style preferences, opt-in policies (e.g. which
tables you've marked private), etc.

---

## About Gymroom

A Hyrox training log. One screen: pick a station (Running plus the eight
Hyrox stations in race order — the run before each station is logged under
Running), log a set with weight, reps and time, and see your best set each
week for the station you choose alongside the full history of every set. A
best set is the fastest time — Hyrox is a race — ties going to more reps,
then heavier weight; a timed set always beats an untimed one, and when no
set of a station has a time the best is the heaviest weight, then more
reps. Weeks start on Monday.

## App-specific conventions

- Both tables (`exercises`, `sets`) are `staging:private` — they hold only
  per-user workout data. The Hyrox stations are a fixed, append-only list
  of `s:` refs in `server.js` (mirrored in `public/index.html`); never
  rename or remove a slug, since sets reference it. The `exercises` table
  is kept but no longer read or written; sets logged against old `c:` or
  starter refs stay saved but are hidden from every response. Rows created
  while a `?demo=1` request is in flight carry `is_demo = true` and are
  filtered out of every response without it.
- Weight in kilograms only (0–1000, steps of 0.25); time per set typed as
  m:ss and stored as seconds (1–86400); reps 1–1000. A set stores at least
  one of the three.

## Design

- **Palette:** warm gym neutrals with one deep orange action colour.
  Light: ground 250 247 243, surface 255 255 255, raised 243 238 232,
  ink 33 27 22, muted 96 87 78, line 226 219 210, orange 194 65 12 with
  white text on it, plate 33 27 22 (iron black), bar 168 160 152.
  Dark, same hues: ground 24 20 17, surface 34 29 25, raised 46 40 35,
  ink 245 240 234, muted 176 166 156, line 64 57 50, orange 251 146 60
  with 43 17 4 text on it, plate 232 225 216 (pale plates read on a dark
  ground), bar 120 112 104. Follows the viewer's Homeroom theme.
- **Signature element:** the loaded barbell, drawn for the weighted
  stations only (sled push, sled pull, farmers carry, sandbag lunges, wall
  balls) — the best set's weight drawn as real plates on a 20 kg bar,
  25 kg plates in the action orange (the red of competition 25s), smaller
  ones in iron black, with a line saying what the bar carries for that
  time ("With 130 kg: 25 + 25 + 5 kg a side, 20 kg bar"). A best set
  under 20 kg or without weight shows the empty bar and says so. Running,
  SkiErg, Rowing and Burpee broad jumps show the best set with no bar.
- **Type scale:** `text-title`, `text-heading`, `text-body`, `text-small`;
  the system's rounded face (`ui-rounded`), numbers in semibold (`.num`).
- The screen's one job is logging the next set quickly: Log set is the
  one filled button; everything else is for reading.

The kit is in `styles/tailwind-input.css`: colour tokens with a light and
a dark value (named in `tailwind.config.js`), and a few components
(`page-column`, `btn-primary`, `btn-secondary`, `field`, `list`, `list-row`,
`card`, `section-label`, `skeleton`, `state-empty`, `state-error`).
Re-theme by changing the token values there, keeping every text pair at
4.5:1 or more in both looks.

- Colour comes only from the tokens (`bg-ground`, `bg-surface`,
  `text-fg`, `text-muted`, `border-line`, `bg-accent` with
  `text-on-accent`, ...): never a raw hex value or a stock palette class.
- Tap targets are at least 44 px; the buttons and fields already are.
- A field's label says what it is; its placeholder, if any, is an example
  that says so ("e.g. 5.0"), never a bare value that could pass for one
  already entered.
- Each screen sits in `page-column`, one centred column on a wide window.
- Every screen that loads data has honest loading, empty and error states.
  Never show the empty state while loading or after a failure; an error says
  what failed, what still works, and offers Retry. Loading has the content's
  own shape (its rows, with `skeleton` bars for their text).
- Seed obviously fake staging demo data so the populated screen can be seen
  ("Staging mock data" in the platform conventions).
- No cards in cards, no uppercase eyebrows, no emoji as icons.
- A header that shows the app's own mark shows the project's icon there
  (the emoji in `dapp.json`'s `icon` block) or no mark at all: never an
  empty tile, and never `brand/icon.png`, which the app does not serve.

## App-specific conventions

_(optional — e.g. "all currency values stored as integer cents, not
floats"; "the `posts` table is append-only"; "avoid adding new
dependencies"; etc.)_
