const express = require('express');
const router = express.Router();

// ============================================================
//  DEPORTES — API pública (TheSportsDB)
// ============================================================
//  Fuente: https://www.thesportsdb.com/api.php   (JSON v1, sin registro)
//  La clave de prueba gratuita "123" permite consultas de lectura. Si más
//  adelante usas una clave propia, agregala en backend/.env:
//      SPORTSDB_KEY=tu_clave
//  y no hay que tocar este archivo.
//
//  Endpoints que expone:
//    GET /api/sports/matches -> proximos partidos (Liga MX primero) con
//                               escudos, hora en Mexico y estado (vivo/final)
//    GET /api/sports/table   -> tabla de posiciones de la Liga MX
//
//  Si la API publica no responde, se devuelve data de ejemplo para que la
//  pantalla nunca se quede en blanco.
// ============================================================

const SPORTSDB_KEY = process.env.SPORTSDB_KEY || '123';
const SPORTSDB_BASE = `https://www.thesportsdb.com/api/v1/json/${SPORTSDB_KEY}`;

const LEAGUE_ID = '4350';            // Mexican Liga MX dentro de TheSportsDB
const LEAGUE_LABEL = 'Liga MX';
const CACHE_TTL_MS = Number(process.env.SPORTS_CACHE_MINUTES || 30) * 60 * 1000;
// La version gratuita de la API corta las rafagas (HTTP 429 de Cloudflare),
// por eso las consultas van una detras de otra, con una pausa entre ellas.
const REQUEST_SPACING_MS = Number(process.env.SPORTS_REQUEST_SPACING_MS || 1500);
const TIMEOUT_MS = 6000;
const MAX_MATCHES = 12;
const TZ = 'America/Mexico_City';

// ---- Data de ejemplo (fallback si la API publica no responde) ----
const MOCK_MATCHES = [
  {
    id: 'm1',
    league: 'Futbol • Liga MX',
    leagueId: LEAGUE_ID,
    hot: true,
    teamHome: 'Pumas Unam',
    teamAway: 'Club Leon',
    crestHome: null,
    crestAway: null,
    time: '21:05',
    date: '10/09/2026',
    status: 'upcoming',
    statusLabel: '',
    scoreHome: null,
    scoreAway: null,
    odds: null
  },
  {
    id: 'm2',
    league: 'Futbol • Liga MX',
    leagueId: LEAGUE_ID,
    hot: false,
    teamHome: 'Tigres UANL',
    teamAway: 'Monterrey',
    crestHome: null,
    crestAway: null,
    time: '19:00',
    date: '11/09/2026',
    status: 'upcoming',
    statusLabel: '',
    scoreHome: null,
    scoreAway: null,
    odds: null
  }
];

// ---- Cache simple en memoria ----
const cache = new Map();     // valor fresco { ts, value }
const lastGood = new Map();  // ultimo valor bueno (se sirve si la API falla)
const inflight = new Map();

async function cached(key, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.value;
  if (inflight.has(key)) return inflight.get(key);
  const promise = loader()
    .then((value) => {
      cache.set(key, { ts: Date.now(), value });
      lastGood.set(key, value);
      return value;
    })
    .catch((err) => {
      const stale = lastGood.get(key);
      if (stale) {
        console.warn(`[sports] ${key}: ${err.message}. Se sirve el ultimo dato conocido.`);
        return stale;
      }
      throw err;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

// ---- Cliente de TheSportsDB ----
async function getJSON(endpoint) {
  const res = await fetch(`${SPORTSDB_BASE}/${endpoint}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (res.status === 429) {
    const err = new Error(`429 (rate limit) en ${endpoint}`);
    err.retryAfter = Number(res.headers.get('retry-after')) || 60;
    throw err;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${endpoint}`);
  const body = await res.text();
  try {
    return JSON.parse(body);
  } catch (e) {
    throw new Error(`respuesta no JSON en ${endpoint}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Un endpoint puede pedir espera (429 con retry-after). Se reintenta una sola
// vez esperando lo que indique la API, con un tope para no colgar la peticion.
async function fetchEventEndpoint(endpoint) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await getJSON(endpoint);
      return Array.isArray(data.events) ? data.events : [];
    } catch (err) {
      if (err.retryAfter && attempt === 0) {
        const wait = Math.min(err.retryAfter * 1000, 20000);
        console.warn(`[sports] rate limit en ${endpoint}: se reintenta en ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
  return [];
}

// Las consultas van secuenciales: la API gratuita tira 429 con rafagas.
async function fetchEventsSequential(endpoints) {
  const events = [];
  for (let i = 0; i < endpoints.length; i++) {
    try {
      events.push(...await fetchEventEndpoint(endpoints[i]));
    } catch (err) {
      console.warn(`[sports] fallo en ${endpoints[i]}: ${err.message}`);
    }
    if (i < endpoints.length - 1) await sleep(REQUEST_SPACING_MS);
  }
  return events;
}

// ---- Utilidades de fecha/hora (hora de Mexico) ----
function mexicoDateStr(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  // en-CA -> YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d);
}

function formatMoment(ts) {
  const time = new Intl.DateTimeFormat('es-MX', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(ts);
  const date = new Intl.DateTimeFormat('es-MX', {
    timeZone: TZ, day: '2-digit', month: '2-digit'
  }).format(ts);
  return { time, date };
}

// TheSportsDB marca: NS (no inicia), 1H/2H/HT (en vivo), FT (finalizado),
// Postponed (aplazado).
function mapStatus(status) {
  const v = String(status || '').toUpperCase();
  if (/POSTPON/.test(v)) return 'postponed';
  if (/^(1H|2H|HT|LIVE|PROG|ET|BREAK)/.test(v)) return 'live';
  if (/^(FT|AET|PEN|MATCH FINISHED)/.test(v)) return 'finished';
  return 'upcoming';
}

const STATUS_LABEL = {
  live: 'EN VIVO',
  finished: 'FINAL',
  postponed: 'POSTPONIDO',
  upcoming: ''
};

function mapEvent(ev) {
  const stamp = ev.strTimestamp || `${ev.dateEvent || ''}T${ev.strTime || '00:00:00'}`;
  const parsed = new Date(/Z|[+-]\d\d:?\d\d$/.test(stamp) ? stamp : `${stamp}Z`);
  const ts = isNaN(parsed.getTime()) ? Date.now() : parsed.getTime();
  const { time, date } = formatMoment(new Date(ts));
  const status = mapStatus(ev.strStatus);

  const minsToKickoff = (ts - Date.now()) / 60000;
  const hot = status === 'live' || (status === 'upcoming' && minsToKickoff > -15 && minsToKickoff < 120);

  const homeScore = ev.intHomeScore != null && ev.intHomeScore !== '' ? Number(ev.intHomeScore) : null;
  const awayScore = ev.intAwayScore != null && ev.intAwayScore !== '' ? Number(ev.intAwayScore) : null;

  return {
    id: String(ev.idEvent || `${ev.strHomeTeam}-${ev.strAwayTeam}-${ts}`),
    league: ev.strLeague || LEAGUE_LABEL,
    leagueId: String(ev.idLeague || ''),
    timestamp: ts,
    hot,
    teamHome: ev.strHomeTeam || 'Local',
    teamAway: ev.strAwayTeam || 'Visitante',
    crestHome: ev.strHomeTeamBadge || null,
    crestAway: ev.strAwayTeamBadge || null,
    time,
    date,
    status,
    statusLabel: STATUS_LABEL[status],
    scoreHome: homeScore,
    scoreAway: awayScore,
    // La API publica no trae momios: se deja null y el front muestra "—".
    odds: null
  };
}

const STATUS_RANK = { live: 0, upcoming: 1, finished: 2, postponed: 3 };

// ---- Tabla de posiciones ----
async function loadTable() {
  const data = await getJSON(`lookuptable.php?l=${LEAGUE_ID}`);
  const rows = data.table || [];
  if (!rows.length) throw new Error('TheSportsDB: tabla vacia');
  return rows.map((r) => ({
    teamId: r.idTeam || null,
    rank: Number(r.intRank) || 0,
    team: r.strTeam || '',
    badge: r.strBadge || null,
    played: r.intPlayed != null ? Number(r.intPlayed) : null,
    win: r.intWin != null ? Number(r.intWin) : null,
    draw: r.intDraw != null ? Number(r.intDraw) : null,
    loss: r.intLoss != null ? Number(r.intLoss) : null,
    goalsFor: r.intGoalsFor != null ? Number(r.intGoalsFor) : null,
    goalsAgainst: r.intGoalsAgainst != null ? Number(r.intGoalsAgainst) : null,
    points: r.intPoints != null ? Number(r.intPoints) : null,
    form: r.strForm || ''
  }));
}

// ---- Partidos ----
async function loadMatches() {
  const today = mexicoDateStr(0);
  const tomorrow = mexicoDateStr(1);
  const inTwoDays = mexicoDateStr(2);

  // Los siguientes partidos de los equipos de la liga completan la cartelera
  // (la version gratuita solo devuelve un partido por liga).
  let teamIds = [];
  try {
    teamIds = (await cached('table', loadTable)).slice(0, 4).map((r) => r.teamId).filter(Boolean);
  } catch (e) {
    teamIds = [];
  }

  const endpoints = [
    `eventsnextleague.php?id=${LEAGUE_ID}`,
    `eventsday.php?d=${today}&s=Soccer`,
    `eventsday.php?d=${tomorrow}&s=Soccer`,
    `eventsday.php?d=${inTwoDays}&s=Soccer`,
    ...teamIds.map((id) => `eventsnext.php?id=${id}`)
    // Nota: `eventslive.php` no existe en la version gratuita (404), por eso no
    // se consulta. Los partidos en vivo llegan por los eventos de estos
    // endpoints, que traen su estado (1H/2H/HT) y se marca como EN VIVO.
  ];

  const raw = await fetchEventsSequential(endpoints);

  if (!raw.length) throw new Error('TheSportsDB: sin eventos');

  const byId = new Map();
  for (const ev of raw) {
    const key = ev.idEvent || `${ev.strHomeTeam}-${ev.strAwayTeam}-${ev.dateEvent}`;
    if (!byId.has(key)) byId.set(key, ev);
  }

  let list = [...byId.values()].map(mapEvent);
  list.sort((a, b) => {
    const aLiga = a.leagueId === LEAGUE_ID ? 0 : 1;
    const bLiga = b.leagueId === LEAGUE_ID ? 0 : 1;
    if (aLiga !== bLiga) return aLiga - bLiga;
    if (STATUS_RANK[a.status] !== STATUS_RANK[b.status]) return STATUS_RANK[a.status] - STATUS_RANK[b.status];
    return a.timestamp - b.timestamp;
  });

  const result = {
    matches: list.slice(0, MAX_MATCHES),
    source: 'thesportsdb',
    updatedAt: new Date().toISOString()
  };

  // Si esta tanda salio incompleta (rate limit), es mejor servir el dato
  // guardado la vez anterior que dejar la pantalla a medias.
  const prev = lastGood.get('matches');
  if (prev && prev.matches && prev.matches.length > result.matches.length) {
    console.warn('[sports] tanda incompleta: se conserva el dato anterior.');
    return prev;
  }
  return result;
}

// ============================================================
//  Rutas
// ============================================================

router.get('/matches', async (req, res) => {
  try {
    const data = await cached('matches', loadMatches);
    res.json(data);
  } catch (err) {
    console.warn('[sports] API publica no disponible, se usan datos de ejemplo:', err.message);
    res.json({
      matches: MOCK_MATCHES,
      source: 'demo',
      updatedAt: new Date().toISOString()
    });
  }
});

router.get('/table', async (req, res) => {
  try {
    const rows = await cached('table', loadTable);
    res.json({
      league: LEAGUE_LABEL,
      leagueFull: 'Mexican Liga MX',
      table: rows.map(({ teamId, ...row }) => row),
      source: 'thesportsdb',
      updatedAt: new Date().toISOString()
    });
  } catch (err) {
    console.warn('[sports] no se pudo obtener la tabla:', err.message);
    res.json({ league: LEAGUE_LABEL, leagueFull: 'Mexican Liga MX', table: [], source: 'demo' });
  }
});

module.exports = router;

// Calienta la cache al arrancar el servidor: la primera persona que abra la
// pantalla de Deportes recibe datos en vez de esperar la consulta a la API.
setTimeout(() => {
  cached('table', loadTable).catch(() => {});
  cached('matches', loadMatches).catch(() => {});
}, 2000).unref?.();
