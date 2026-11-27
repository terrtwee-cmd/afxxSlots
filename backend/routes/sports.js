const express = require('express');
const router = express.Router();

// ============================================================
//  DEPORTES — momios reales (ESPN) + tabla Liga MX (TheSportsDB)
// ============================================================
//  Fuente de PARTIDOS y MOMIOS:
//    https://site.api.espn.com/apis/site/v2/sports/soccer/<liga>/scoreboard
//    API publica de ESPN, sin registro. Trae los partidos programados con
//    las cuotas del bookmaker que publica el evento (hoy DraftKings) en
//    formato AMERICANO (+150 / -120 / 235) dentro de
//    competitions[0].odds[].moneyline.
//
//  Formato de las cuotas en cada lado:
//      odds[].moneyline.home.open.odds | .close.odds | .current.odds
//      odds[].moneyline.away.open.odds | .close.odds | .current.odds
//      odds[].drawOdds.moneyLine
//    Prioridad de lectura: current -> close -> open.
//
//  OJO: el arreglo odds[] empieza con un elemento null y el dato real
//  viene despues, asi que se recorre completo y se usa el primer
//  elemento que traiga moneyline.
//
//  Fuente de la TABLA de posiciones:
//    https://www.thesportsdb.com/api.php (JSON v1, clave gratis "123")
//
//  Endpoints que expone:
//    GET /api/sports/matches -> proximos partidos con momios reales,
//                              escudos, hora en Mexico y estado (vivo/final)
//    GET /api/sports/table   -> tabla de posiciones de la Liga MX
//
//  Si la API publica no responde, se devuelve data de ejemplo para que la
//  pantalla nunca se quede en blanco.
// ============================================================

const SPORTSDB_KEY = process.env.SPORTSDB_KEY || '123';
const SPORTSDB_BASE = `https://www.thesportsdb.com/api/v1/json/${SPORTSDB_KEY}`;

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const LEAGUE_ID = '4350';            // Mexican Liga MX dentro de TheSportsDB
const LEAGUE_LABEL = 'Liga MX';
const CACHE_TTL_MS = Number(process.env.SPORTS_CACHE_MINUTES || 30) * 60 * 1000;
const TIMEOUT_MS = 8000;
const MAX_MATCHES = Number(process.env.SPORTS_MAX_MATCHES || 24);
const TZ = 'America/Mexico_City';

// ---- Las ligas que se consultan, en orden de prioridad (Liga MX primero) ----
// ESPN usa un identificador propio por liga; el nombre es el que ve el usuario.
const LEAGUES = [
  { id: 'mex.1', name: 'Liga MX', country: 'México' },
  { id: 'eng.1', name: 'Premier League', country: 'Inglaterra' },
  { id: 'esp.1', name: 'LaLiga', country: 'España' },
  { id: 'ger.1', name: 'Bundesliga', country: 'Alemania' },
  { id: 'ita.1', name: 'Serie A', country: 'Italia' },
  { id: 'fra.1', name: 'Ligue 1', country: 'Francia' },
  { id: 'ned.1', name: 'Eredivisie', country: 'Países Bajos' },
  { id: 'por.1', name: 'Primeira Liga', country: 'Portugal' },
  { id: 'arg.1', name: 'Liga Profesional', country: 'Argentina' },
  { id: 'bra.1', name: 'Brasileirão', country: 'Brasil' },
  { id: 'usa.1', name: 'MLS', country: 'EEUU' },
  { id: 'chi.1', name: 'Primera División', country: 'Chile' },
  { id: 'col.1', name: 'Primera A', country: 'Colombia' },
  { id: 'uefa.champions', name: 'UEFA Champions League', country: 'Europa' },
  { id: 'uefa.europa', name: 'UEFA Europa League', country: 'Europa' }
];

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

// ---- Cliente HTTP ----
async function fetchJSON(url, headers = {}) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0', ...headers },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (res.status === 429) {
    const err = new Error(`429 (rate limit) en ${url}`);
    err.retryAfter = Number(res.headers.get('retry-after')) || 60;
    throw err;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  try {
    return await res.json();
  } catch (e) {
    throw new Error(`respuesta no JSON en ${url}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Utilidades de fecha/hora (hora de Mexico) ----
function formatMoment(ts) {
  const time = new Intl.DateTimeFormat('es-MX', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(ts);
  const date = new Intl.DateTimeFormat('es-MX', {
    timeZone: TZ, day: '2-digit', month: '2-digit'
  }).format(ts);
  return { time, date };
}

const STATUS_LABEL = {
  live: 'EN VIVO',
  finished: 'FINAL',
  postponed: 'POSTPONIDO',
  upcoming: ''
};

// ============================================================
//  Momios (formato americano)
// ============================================================
//  ESPN entrega el momio por lado como {current,close,open} y el empate
//  como numero plano (o como objeto segun el evento). Se lee el valor mas
//  reciente disponible: current -> close -> open.
function readSide(side) {
  if (!side || typeof side !== 'object') return null;
  const cur = side.current && side.current.odds;
  const close = side.close && side.close.odds;
  const open = side.open && side.open.odds;
  const val = cur ?? close ?? open;
  return val == null ? null : String(val);
}

function readDraw(drawOdds) {
  if (!drawOdds) return null;
  let val = drawOdds.moneyLine;
  if (val && typeof val === 'object') {
    const cur = val.current && val.current.odds;
    const close = val.close && val.close.odds;
    const open = val.open && val.open.odds;
    val = cur ?? close ?? open;
  }
  return val == null ? null : String(val);
}

// Recorre el arreglo odds[] porque el primer elemento suele venir en null
// y el dato real (con moneyline) viene despues.
function extractOdds(oddsArray) {
  if (!Array.isArray(oddsArray)) return null;
  for (const o of oddsArray) {
    if (!o || typeof o !== 'object') continue;
    const ml = o.moneyline;
    if (!ml) continue;
    const home = readSide(ml.home);
    const away = readSide(ml.away);
    const draw = readDraw(o.drawOdds);
    if (!home && !away) continue;
    return {
      home: home,
      draw: draw,
      away: away,
      provider: (o.provider && o.provider.name) || null,
      overUnder: o.overUnder == null ? null : o.overUnder,
      format: 'american'
    };
  }
  return null;
}

// ---- Mapeo de un evento de ESPN ----
function mapEspnEvent(ev, league, leagueIndex) {
  const comp = (ev.competitions || [])[0];
  if (!comp) return null;

  const competitors = comp.competitors || [];
  const home = competitors.find((c) => c.homeAway === 'home') || competitors[0] || {};
  const away = competitors.find((c) => c.homeAway === 'away') || competitors[1] || {};
  if (!home.team || !away.team) return null;

  const ts = ev.date ? Date.parse(ev.date) : Date.now();
  if (isNaN(ts)) return null;
  const { time, date } = formatMoment(ts);

  const state = ((ev.status || {}).type || {}).state || ((comp.status || {}).type || {}).state;
  let status = 'upcoming';
  if (state === 'in') status = 'live';
  else if (state === 'post') status = 'finished';

  const minsToKickoff = (ts - Date.now()) / 60000;
  const hot = status === 'live' || (status === 'upcoming' && minsToKickoff > -15 && minsToKickoff < 120);

  const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  };

  const clock = ((ev.status || {}).type || {}).shortDetail || null;

  return {
    id: String(ev.id || `${league.id}-${ts}`),
    league: league.name,
    leagueId: league.id,
    leagueCountry: league.country,
    leagueIndex,
    timestamp: ts,
    hot,
    teamHome: home.team.displayName || 'Local',
    teamAway: away.team.displayName || 'Visitante',
    crestHome: (home.team && home.team.logo) || null,
    crestAway: (away.team && away.team.logo) || null,
    time,
    date,
    status,
    statusLabel: STATUS_LABEL[status],
    clock: status === 'live' ? clock : null,
    scoreHome: num(home.score),
    scoreAway: num(away.score),
    odds: extractOdds(comp.odds)
  };
}

// ---- Partidos ----
// Las ligas se consultan en paralelo (unas 5 a la vez) para no tardar.
async function loadMatches() {
  const results = [];
  const queue = LEAGUES.map((lg, i) => ({ lg, i }));

  async function worker() {
    while (queue.length) {
      const { lg, i } = queue.shift();
      try {
        const data = await fetchJSON(`${ESPN_BASE}/${lg.id}/scoreboard`);
        const events = data.events || [];
        for (const ev of events) {
          const m = mapEspnEvent(ev, lg, i);
          if (m) results.push(m);
        }
      } catch (err) {
        console.warn(`[sports] fallo en ${lg.id}: ${err.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: 5 }, () => worker()));

  if (!results.length) throw new Error('ESPN: sin eventos');

  const STATUS_RANK = { live: 0, upcoming: 1, finished: 2, postponed: 3 };
  results.sort((a, b) => {
    if (a.leagueIndex !== b.leagueIndex) return a.leagueIndex - b.leagueIndex;
    if (STATUS_RANK[a.status] !== STATUS_RANK[b.status]) return STATUS_RANK[a.status] - STATUS_RANK[b.status];
    return a.timestamp - b.timestamp;
  });

  const matches = results.slice(0, MAX_MATCHES);
  const withOdds = matches.filter((m) => m.odds).length;

  const result = {
    matches,
    source: 'espn',
    oddsFormat: 'american',
    withOdds,
    updatedAt: new Date().toISOString()
  };

  // Si esta tanda salio incompleta, es mejor servir el dato guardado la vez
  // anterior que dejar la pantalla a medias.
  const prev = lastGood.get('matches');
  if (prev && prev.matches && prev.matches.length > matches.length) {
    console.warn('[sports] tanda incompleta: se conserva el dato anterior.');
    return prev;
  }
  return result;
}

// ============================================================
//  Tabla de posiciones (TheSportsDB)
// ============================================================
async function loadTable() {
  const data = await fetchJSON(`${SPORTSDB_BASE}/lookuptable.php?l=${LEAGUE_ID}`);
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
