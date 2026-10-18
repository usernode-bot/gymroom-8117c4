const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const app = express();
const port = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// The platform signs user-identity tokens with an RSA private key it never
// shares. Containers get only the PUBLIC half, so this app can verify who a
// user is but cannot mint an identity — and neither can any other app.
const JWT_PUBLIC_KEY = (process.env.USERNODE_JWT_PUBLIC_KEY || '')
  .replace(/\\n/g, '\n');

// Tokens are minted for one app: the audience is this app's numeric id, so a
// token issued for a different app is rejected below rather than accepted as
// a valid user.
const APP_AUDIENCE = process.env.USERNODE_APP_ID
  ? 'usernode:app:' + process.env.USERNODE_APP_ID
  : null;

// Visitors with no Homeroom account ("guests") may look around this app at
// its own address, read-only (every public app). The platform marks
// them with a token of their own: ES256, signed by a key of its own (its
// public half is USERNODE_GUEST_JWT_PUBLIC_KEY), this audience, `pur:
// 'guest'`, `guest: true`, and no id or username. Such a visitor is
// `req.guest`, never `req.user`, and every write they try is answered 401
// `account_required`, which the bridge turns into "Make an account to
// continue".
const GUEST_AUDIENCE = APP_AUDIENCE ? APP_AUDIENCE + ':guest' : null;
const GUEST_PUBLIC_KEY = (process.env.USERNODE_GUEST_JWT_PUBLIC_KEY || '')
  .replace(/\\n/g, '\n');

// Paths that stay open without authentication. Add a path here (and add it
// with `app.get`/`app.post` below) if you deliberately want it public.
// Everything else requires a valid platform-issued JWT.
const PUBLIC_API_PATHS = new Set(['/health']);

app.use(express.json());

// The platform's three centrally hosted files — the bridge, the native UI
// kit and the Tailwind runtime — are reachable at these paths on this app's
// OWN origin, so index.html can load them with a RELATIVE path and never
// name the platform's hostname. A hostname baked into an app is what breaks
// every app at once when the platform's domain moves.
//
// In production and on a staging preview the platform's edge answers these
// before the request ever reaches this process (a per-app Ingress rule on
// Kubernetes, the wildcard site's matcher on the docker runtime). This
// handler is what makes the same relative paths work under a plain
// `node server.js`, where there is no edge in front of the app at all.
//
// Registered BEFORE the auth middleware because these three files are
// public: the platform serves them anonymously from any app origin, and a
// login redirect arriving where a <script> was expected is exactly the
// failure a relative path is meant to avoid.
// The platform's origin, at RUNTIME, and ONLY from the variable the platform
// injects. No hostname is written into this file: a baked-in one is what left
// the whole fleet pointing at a domain the platform had moved away from.
// Unset only outside the platform (a plain local `node server.js`) — set
// USERNODE_PLATFORM_ORIGIN there too if you want the hosted assets locally.
const PLATFORM_ORIGIN = (process.env.USERNODE_PLATFORM_ORIGIN || '')
  .replace(/\/+$/, '');

app.get(/^\/usernode-(?:bridge|native|tailwind)\//, async (req, res) => {
  try {
    if (!PLATFORM_ORIGIN) return res.sendStatus(503);
    const upstream = await fetch(PLATFORM_ORIGIN + req.path);
    if (!upstream.ok) return res.sendStatus(upstream.status);
    const type = upstream.headers.get('content-type');
    if (type) res.type(type);
    // max-age=0 with revalidation, never a long TTL: the whole point of
    // central hosting is that a platform-side fix lands on the next load.
    res.set('Cache-Control', 'public, max-age=0, must-revalidate');
    return res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.warn('hosted asset fetch failed: ' + err.message);
    return res.sendStatus(502);
  }
});

// "Now" for this request, as a Date: `req.now`, set for every request by
// the middleware below. Read the day and the time through it (and
// `usernode.now()` in the page), never `new Date()` or SQL's NOW(),
// wherever they decide what shows: a reminder, a rota, a deadline.
// Production always gets the real time. A staging preview may be shown as of
// a chosen moment: the platform opens it with `?un-now=<ISO time>`, and the
// page sends `usernode.now()` on as the `x-usernode-now` header. Only a
// staging container reads either. See "Time-dependent features" in the
// platform conventions.
const IS_STAGING = process.env.USERNODE_ENV === 'staging';
const PREVIEW_NOW = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
function requestNow(req) {
  const raw = IS_STAGING ? (req.headers['x-usernode-now'] || req.query['un-now']) : null;
  return typeof raw === 'string' && PREVIEW_NOW.test(raw) ? new Date(raw) : new Date();
}

// Verify platform-issued JWT if one was passed, then enforce auth on
// anything not explicitly marked public. The iframe adds `?token=…`
// on load; the frontend script forwards the token via `x-usernode-token`
// on subsequent fetches.
app.use((req, res, next) => {
  req.now = requestNow(req);
  const token = req.query.token || req.headers['x-usernode-token'];
  if (token && JWT_PUBLIC_KEY && APP_AUDIENCE) {
    try {
      // Pin the algorithm, issuer and audience. Without `algorithms` a
      // caller could hand us an HS256 token signed with the public PEM
      // (which every app knows) and forge any user.
      const claims = jwt.verify(token, JWT_PUBLIC_KEY, {
        algorithms: ['RS256'],
        issuer: 'usernode',
        audience: APP_AUDIENCE,
      });
      // `pur` names what the token is for. Only user-identity tokens
      // authenticate a person here.
      if (claims && claims.pur === 'iframe') req.user = claims;
    } catch {}
  }
  if (!req.user && token && GUEST_PUBLIC_KEY && GUEST_AUDIENCE) {
    try {
      const guest = jwt.verify(token, GUEST_PUBLIC_KEY, {
        algorithms: ['ES256'],
        issuer: 'usernode',
        audience: GUEST_AUDIENCE,
      });
      if (guest && guest.pur === 'guest' && guest.guest === true) req.guest = true;
    } catch {}
  }

  // Static assets (CSS/JS/images) are always served; the API and the HTML
  // shell are gated so direct hits to the staging/prod subdomain don't
  // leak app data to the public internet. A guest may READ: every GET,
  // `/api/*` included, so read routes must not assume req.user (use
  // `req.user ? req.user.id : null`). Every write needs an account.
  if (req.method !== 'GET' || req.path.startsWith('/api/')) {
    if (PUBLIC_API_PATHS.has(req.path)) return next();
    if (!req.user && req.guest) {
      if (req.method === 'GET' || req.method === 'HEAD') return next();
      return res.status(401).json({ error: 'account_required' });
    }
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});

app.get('/health', (_req, res) => {
  if (shuttingDown) return res.status(503).json({ status: 'draining' });
  res.json({ status: 'ok' });
});

// ── Gymroom ──────────────────────────────────────────────────────────────
// Two private tables: the sets a person logged, and (no longer written) the
// own exercises a person once added. Both hold only per-user workout data,
// so both are staging:private. The Hyrox stations are a fixed, append-only
// list in code, like the starter list was: sets reference the slugs, so
// never rename or remove one. The exercises table stays for data already in
// it but is no longer read or written.
const STATIONS = [
  { slug: 'running', name: 'Running', order: 0, weighted: false },
  { slug: 'ski-erg', name: 'SkiErg', order: 1, weighted: false },
  { slug: 'sled-push', name: 'Sled push', order: 2, weighted: true },
  { slug: 'sled-pull', name: 'Sled pull', order: 3, weighted: true },
  { slug: 'burpee-broad-jumps', name: 'Burpee broad jumps', order: 4, weighted: false },
  { slug: 'rowing', name: 'Rowing', order: 5, weighted: false },
  { slug: 'farmers-carry', name: 'Farmers carry', order: 6, weighted: true },
  { slug: 'sandbag-lunges', name: 'Sandbag lunges', order: 7, weighted: true },
  { slug: 'wall-balls', name: 'Wall balls', order: 8, weighted: true },
];
const STATION_REFS = STATIONS.map((s) => 's:' + s.slug);

async function setupSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS exercises (
    id serial PRIMARY KEY,
    owner_id text NOT NULL,
    name text NOT NULL,
    is_demo boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS sets (
    id serial PRIMARY KEY,
    owner_id text NOT NULL,
    exercise_ref text NOT NULL,
    weight_kg numeric,
    reps int,
    seconds int,
    logged_at timestamptz NOT NULL,
    is_demo boolean NOT NULL DEFAULT false,
    demo_key text
  )`);
  // Backs the demo seed's ON CONFLICT (owner_id, demo_key). Real sets have a
  // NULL demo_key and Postgres keeps NULLs distinct in a unique index.
  await pool.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS sets_owner_demo_key_idx ON sets (owner_id, demo_key)');
  await pool.query(`COMMENT ON TABLE exercises IS 'staging:private'`);
  await pool.query(`COMMENT ON TABLE sets IS 'staging:private'`);
}

function demoMode(req) {
  return IS_STAGING && req.query.demo === '1';
}

// ── Stations ─────────────────────────────────────────────────────────────
// The stations are a fixed list in code, so this is a constant reply: no
// table read, and it works the same for guests.
app.get('/api/exercises', (_req, res) => {
  res.json({
    stations: STATIONS.map((s) => ({
      ref: 's:' + s.slug, name: s.name, order: s.order, weighted: s.weighted,
    })),
  });
});

// ── Sets ─────────────────────────────────────────────────────────────────
app.get('/api/sets', async (req, res) => {
  const demo = demoMode(req);
  try {
    if (demo && req.user) await seedDemoSets(req.user.id, req.now);
    // Only station sets are returned. Sets logged against the old starter
    // list and own exercises stay saved but hidden.
    const rows = req.user
      ? await pool.query(
          'SELECT id, exercise_ref, weight_kg, reps, seconds, logged_at, is_demo FROM sets ' +
          'WHERE owner_id = $1 AND exercise_ref = ANY($2)' +
          (demo ? '' : ' AND NOT is_demo') +
          ' ORDER BY logged_at DESC, id DESC',
          [req.user.id, STATION_REFS])
      : { rows: [] };
    res.json({ sets: rows.rows });
  } catch (err) {
    console.error('GET /api/sets failed: ' + err.message);
    res.status(500).json({ error: 'Could not load your sets' });
  }
});

function isBadInt(v, min, max) {
  return v === null || !Number.isInteger(v) || v < min || v > max;
}

app.post('/api/sets', async (req, res) => {
  try {
    const b = req.body || {};
    const ref = typeof b.exercise_ref === 'string' ? b.exercise_ref : '';
    const weight = b.weight_kg === undefined || b.weight_kg === null || b.weight_kg === ''
      ? null : Number(b.weight_kg);
    const reps = b.reps === undefined || b.reps === null || b.reps === ''
      ? null : Number(b.reps);
    const seconds = b.seconds === undefined || b.seconds === null || b.seconds === ''
      ? null : Number(b.seconds);

    // At least one of the three, each in its own valid range.
    const hasAny = weight !== null || reps !== null || seconds !== null;
    const weightOk = weight === null
      || (Number.isFinite(weight) && weight >= 0 && weight <= 1000
          && Math.round(weight * 4) === weight * 4);
    const repsOk = reps === null || (!isBadInt(reps, 1, 1000) && Number.isInteger(reps));
    const secondsOk = seconds === null || (!isBadInt(seconds, 1, 86400) && Number.isInteger(seconds));
    if (!hasAny || !weightOk || !repsOk || !secondsOk) {
      return res.status(400).json({
        error: 'Enter at least one of weight, reps or time, each within its range.' });
    }

    // The ref must be one of the fixed Hyrox stations.
    const m = /^s:(.+)$/.exec(ref);
    const refOk = !!(m && STATIONS.some((e) => e.slug === m[1]));
    if (!refOk) return res.status(400).json({ error: 'Unknown exercise.' });

    const ins = await pool.query(
      'INSERT INTO sets (owner_id, exercise_ref, weight_kg, reps, seconds, logged_at, is_demo) ' +
      'VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, exercise_ref, weight_kg, reps, seconds, logged_at, is_demo',
      [req.user.id, ref, weight, reps, seconds, req.now, demoMode(req)]);
    res.status(201).json({ set: ins.rows[0] });
  } catch (err) {
    console.error('POST /api/sets failed: ' + err.message);
    res.status(500).json({ error: 'Could not save the set' });
  }
});

app.delete('/api/sets/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'Not found' });
    const del = await pool.query(
      'DELETE FROM sets WHERE id = $1 AND owner_id = $2 RETURNING id',
      [id, req.user.id]);
    if (del.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: id });
  } catch (err) {
    console.error('DELETE /api/sets/:id failed: ' + err.message);
    res.status(500).json({ error: 'Could not delete the set' });
  }
});

// ── Staging demo (a first version's populated demo, ?demo=1 only) ────────
// Six weeks of Hyrox training: every session logs its run plus two
// stations in race order, so each station trains four times across four
// weeks and all of them have weekly bests. Runs get faster 5:40 → 5:05 and
// the sled push climbs to 150 kg, with today's run and sled push both new
// bests. Fixed demo_keys and ON CONFLICT DO NOTHING keep a reload from
// adding anything and keep deletions deleted.
// Per station, newest first: [weight_kg, reps, seconds], null where unused.
const DEMO_LADDERS = {
  's:running': [
    [null, null, 305], [null, null, 307], [null, null, 309],
    [null, null, 313], [null, null, 315], [null, null, 317],
    [null, null, 320], [null, null, 322], [null, null, 324],
    [null, null, 327], [null, null, 330], [null, null, 333],
    [null, null, 335], [null, null, 338], [null, null, 340],
  ],
  's:ski-erg': [[null, null, 265], [null, null, 270], [null, null, 275], [null, null, 290]],
  's:sled-push': [[150, null, 65], [140, null, 66], [130, null, 68], [110, null, 70]],
  's:sled-pull': [[105, null, 68], [95, null, 70], [90, null, 72], [80, null, 75]],
  's:burpee-broad-jumps': [[null, null, 290], [null, null, 300], [null, null, 310], [null, null, 330]],
  's:rowing': [[null, null, 270], [null, null, 275], [null, null, 285], [null, null, 295]],
  's:farmers-carry': [[24, null, 60], [24, null, 64], [24, null, 68], [24, null, 72]],
  's:sandbag-lunges': [[20, null, 90], [20, null, 95], [20, null, 100], [20, null, 105]],
  's:wall-balls': [[6, 100, null], [6, 90, null], [6, 80, null], [6, 60, null]],
};
// The eight stations in race order (Running is handled separately below).
const DEMO_STATION_REFS = STATION_REFS.slice(1);
const DEMO_TIMES_OF_DAY = [18 * 60 + 30, 7 * 60 + 45, 12 * 60 + 15];

const DEMO_GEN = 'demo-v3';

function seedDemoSets(ownerId, now) {
  // 15 sessions at ~2.5-day gaps ≈ 5 weeks. Session s logs its run, then
  // stations (2s) % 8 and (2s + 1) % 8 in that order — so today's session
  // ends on the sled push — and each station appears four times, four
  // sessions apart. Occurrence counts index the ladders, newest first.
  const occ = {};
  const rows = [];
  let n = 0;
  for (let s = 0; s < 15; s++) {
    const dayBack = Math.round((s * 35) / 14);
    const refs = ['s:running', DEMO_STATION_REFS[(2 * s) % 8], DEMO_STATION_REFS[(2 * s + 1) % 8]];
    let k = 0;
    for (const ref of refs) {
      const step = DEMO_LADDERS[ref][Math.min(occ[ref] || 0, DEMO_LADDERS[ref].length - 1)];
      occ[ref] = (occ[ref] || 0) + 1;
      const weight = step[0], reps = step[1], seconds = step[2];
      // Spread a session's sets a couple of minutes apart, alternating
      // morning, midday and evening slots. Today's session sits in the
      // last few minutes before req.now, so anything logged now lands on
      // top of it.
      const minutes = dayBack === 0
        ? Math.max(0, now.getHours() * 60 + now.getMinutes() - 20 + k * 2)
        : DEMO_TIMES_OF_DAY[(occ[ref] - 1) % 3] + k * 2;
      const logged = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayBack,
        Math.floor(minutes / 60), minutes % 60);
      n += 1;
      k += 1;
      rows.push({ key: DEMO_GEN + '-' + n, ref, weight, reps, seconds, logged });
    }
  }
  const values = [];
  const params = [];
  rows.forEach((r, i) => {
    const b = i * 7;
    values.push('($' + (b + 1) + ', $' + (b + 2) + ', $' + (b + 3) + ', $' + (b + 4) +
      ', $' + (b + 5) + ', $' + (b + 6) + ', true, $' + (b + 7) + ')');
    params.push(ownerId, r.ref, r.weight, r.reps, r.seconds, r.logged, r.key);
  });
  return pool.query(
    'INSERT INTO sets (owner_id, exercise_ref, weight_kg, reps, seconds, logged_at, is_demo, demo_key) VALUES ' +
    values.join(', ') + ' ON CONFLICT (owner_id, demo_key) DO NOTHING', params).then(function (r) {
    // Rows the current seed no longer writes (an older generation) go, so a
    // changed seed shows its own shape. Rows of the CURRENT generation stay
    // untouched — a deleted demo set stays deleted.
    return pool.query(
      "DELETE FROM sets WHERE owner_id = $1 AND demo_key LIKE 'demo-%' AND demo_key NOT LIKE $2",
      [ownerId, DEMO_GEN + '-%']).then(function () { return r; });
  });
}

// The template ships no favicon file; index.html carries an inline SVG
// icon instead. Answer 204 here so anything that still probes
// /favicon.ico (older browsers, direct visits) doesn't fall through to
// the auth-gated catch-all and surface a 401 in the console on every
// fresh load.
app.get('/favicon.ico', (_req, res) => res.status(204).end());

app.use(express.static(path.join(__dirname, 'public')));

// HTML shell: serve the app if authenticated. Unauthenticated top-level
// visits (share links pasted into a browser — Sec-Fetch-Dest: document)
// are sent to the platform's chromeless view of this app, where the shell
// embeds it with a real token so the link just works. Every other
// tokenless case (iframe loads with an expired token, old browsers
// without Sec-Fetch-*) gets the "open in Homeroom" landing page instead
// of a redirect, so the platform shell is never loaded INSIDE its own
// app iframe and stray visits still don't reveal the app.
app.get('*', (req, res) => {
  if (!req.user && !req.guest) {
    // Deep-link pass-through (platform #743): carry the visited
    // path+query into the chromeless view so share links land on the
    // shared screen, not Home. The clean platform route stores `path`
    // as one encoded query value so an inner ?, &, or = survives. The
    // shell decodes and validates it as relative-only before use. The
    // character test keeps the
    // value attribute-safe for the landing anchor below — anything
    // unusual falls back to the bare link.
    const deepPath = /^\/[A-Za-z0-9\-._~!$&()*+,;=:@\/%?]*$/.test(req.originalUrl)
      ? '?path=' + encodeURIComponent(req.originalUrl) : '';
    if (PLATFORM_ORIGIN && req.get('sec-fetch-dest') === 'document') {
      return res.redirect(302, PLATFORM_ORIGIN + '/app/gymroom-8117c4/full' + deepPath);
    }
    return res.status(401).send(`<!doctype html><meta charset=utf-8><title>Open in Homeroom</title>
<body style="font-family:system-ui;background:#09090b;color:#e4e4e7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="max-width:24rem;padding:2rem;text-align:center">
    <h1 style="font-size:1.25rem;margin:0 0 0.5rem">Open this app inside Homeroom</h1>
    <p style="color:#a1a1aa;font-size:0.9rem;margin:0 0 1.25rem">This page is served via the platform; direct visits aren't authenticated.</p>
    <a href="${PLATFORM_ORIGIN}/app/gymroom-8117c4/full${deepPath}" style="display:inline-block;padding:0.5rem 1rem;background:#7c3aed;color:white;border-radius:0.5rem;text-decoration:none;font-size:0.9rem">Open in Homeroom</a>
  </div>
</body>`);
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function start() {
  await setupSchema();
  const server = app.listen(port, () => console.log(`Listening on :${port}`));
  // Let Envoy retire idle upstream connections at 60s, with a 15s margin.
  server.keepAliveTimeout = 75_000;

  // Graceful shutdown: stop accepting connections, drain ~3 s, close the
  // pool, exit. Idempotent, so a repeat signal is a no-op.
  const DRAIN_MS = 3000;
  shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${signal} received, draining`);
    server.close(() => {});
    server.closeIdleConnections?.();
    const t = setTimeout(() => server.closeAllConnections?.(), DRAIN_MS);
    t.unref?.();
    try {
      await pool.end();
    } catch (e) {
      console.error('[shutdown] pool.end failed: ' + e.message);
    }
    process.exit(0);
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

let shuttingDown = false;

start().catch(err => { console.error(err); process.exit(1); });
