// ============================================================
//  PERSISTENCIA DE LA BASE DE DATOS (fuera del disco efimero)
// ============================================================
//  En Render (plan gratuito) el disco del contenedor se borra en cada
//  despliegue o reinicio. Como backend/data.json ya NO se versiona en main,
//  al re-clonar el repo el archivo no existe y, sin esto, se perderian los
//  usuarios, sus contrasenas y la clabe.
//
//  Hay DOS almacenes, y ninguno necesita tokens de GitHub:
//
//  1) TELEGRAM (el principal). El bot guarda la base de datos completa como
//     un documento en un mensaje "checkpoint" del chat. El mensaje se
//     actualiza en el lugar, asi que siempre tiene la version mas reciente
//     y su id nunca cambia. Al arrancar, el servidor lee ese mensaje y
//     restaura todo. Solo hacen falta TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID,
//     que ya estaban configurados en Render.
//
//  2) RAMA "data" del repo (el respaldo). Se lee sin token si el repo es
//     publico, y se escribe solo si hay GITHUB_TOKEN. Es una copia extra
//     de la misma base de datos.
//
//  Al restaurar se fusionan las dos copias con lo que haya en el disco: la
//  union nunca deja fuera un usuario, una contrasena ni la clabe.
//
//  REGLA DE ORO (la que evita que se pierdan usuarios y contrasenas)
//  La base de datos remota NUNCA se pisa con una copia que tenga menos
//  informacion. Todo lo que se sube es una FUSION, y si no se pudo leer
//  lo remoto, no se sube nada.
//
//  Antes pasaba esto: si la restauracion fallaba (sin token, sin red), el
//  servidor seguia adelante y subia la base vacia del disco, pisando la
//  rama "data". Perdia TODOS los usuarios y sus contrasenas de golpe.
// ============================================================

const fs = require('fs');
const path = require('path');
const telegram = require('./telegram');

const BACKEND_DIR = __dirname;
const DB_REL = 'backend/data.json';
const DB_PATH = path.join(BACKEND_DIR, 'data.json');
const BASE_PATH = path.join(BACKEND_DIR, 'data.base.json');

const TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = process.env.GITHUB_REPO || '';
const BRANCH = process.env.GITHUB_DATA_BRANCH || 'data';
// ACTIVO = se puede GUARDAR en la rama "data" (hace falta token).
// LECTURA = se puede LEER la rama "data" (un repo publico se lee sin token).
const ACTIVO = Boolean(TOKEN && REPO);
const LECTURA_ACTIVA = Boolean(REPO);

const API = 'https://api.github.com';
const TIMEOUT_MS = 20000;
// La API de "contents" de GitHub no acepta archivos de mas de ~1 MB.
const MAX_BYTES = 900 * 1024;

let temporizador = null;
let avisadoSinToken = false;

function log(...args) { console.log('[PERSISTENCIA]', ...args); }
function warn(...args) { console.warn('[PERSISTENCIA]', ...args); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(ruta, opciones = {}) {
  const cabeceras = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'afxx-server',
    ...(opciones.headers || {})
  };
  // El token solo hace falta para escribir. Un repo publico se puede leer
  // sin token, asi que la restauracion funciona aunque falte GITHUB_TOKEN.
  if (TOKEN) cabeceras['Authorization'] = `Bearer ${TOKEN}`;

  const res = await fetch(API + ruta, {
    ...opciones,
    headers: cabeceras,
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  const texto = await res.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch (e) { /* respuesta no JSON */ }
  return { ok: res.ok, status: res.status, json };
}

// ============================================================
//  Leer y escribir los archivos locales
// ============================================================

function leerLocal() {
  if (!fs.existsSync(DB_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch (e) {
    warn('data.json local esta danado o vacio:', e.message);
    return null;
  }
}

function escribirLocal(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// El id del mensaje de Telegram donde vive la base de datos. Se busca en
// este orden: la base local, la plantilla del repo y (al restaurar) la
// copia de la rama "data".
function obtenerIdCheckpoint(local) {
  if (local && local.telegramMessageId) return local.telegramMessageId;
  try {
    if (fs.existsSync(BASE_PATH)) {
      const plantilla = JSON.parse(fs.readFileSync(BASE_PATH, 'utf-8'));
      if (plantilla && plantilla.telegramMessageId) return plantilla.telegramMessageId;
    }
  } catch (e) { /* la plantilla no importa para esto */ }
  return null;
}

// ============================================================
//  La rama "data" del repo (respaldo)
// ============================================================

// ok:false significa "no se pudo leer" (no se debe subir nada).
// ok:true con datos:null significa "la rama todavia no tiene base de datos".
async function leerRemoto() {
  if (!LECTURA_ACTIVA) return { ok: false, motivo: 'sin GITHUB_REPO' };
  const res = await api(`/repos/${REPO}/contents/${DB_REL}?ref=${BRANCH}`);
  if (res.status === 404) return { ok: true, datos: null };
  if (!res.ok) return { ok: false, motivo: `GitHub respondio ${res.status}` };
  try {
    const texto = Buffer.from(res.json.content, 'base64').toString('utf-8');
    return { ok: true, datos: JSON.parse(texto) };
  } catch (e) {
    return { ok: false, motivo: 'no se pudo leer el JSON remoto: ' + e.message };
  }
}

// ============================================================
//  Fusion de bases de datos (nunca se pierde nada)
// ============================================================

// Que version es mas nueva: la que tiene el savedAt mas reciente.
function timestamp(db) {
  return Date.parse((db && db.savedAt) || '') || 0;
}

// Una base de datos es valida si trae la lista de usuarios.
function esBaseValida(db) {
  return Boolean(db && Array.isArray(db.users));
}

// ---- Fusionar dos registros que son el mismo (mismo id) ----
// El de la version mas nueva manda, pero se conservan los campos que solo
// tiene el otro. Eso mantiene la contrasena en texto plano aunque la copia
// preferida venga sin ella.
function combinar(preferido, secundario, camposCriticos) {
  const out = { ...secundario, ...preferido };
  for (const campo of camposCriticos || []) {
    const valor = out[campo];
    if (typeof valor !== 'string' || valor === '') {
      const alterno = secundario ? secundario[campo] : undefined;
      if (typeof alterno === 'string' && alterno !== '') out[campo] = alterno;
    }
  }
  return out;
}

// ---- Union de dos listas por id: nunca se pierde un registro ----
function unir(coleccion, viejo, nuevo, camposCriticos) {
  const mapa = new Map();

  for (const item of (viejo && viejo[coleccion]) || []) {
    if (item && item.id) mapa.set(item.id, item);
  }
  for (const item of (nuevo && nuevo[coleccion]) || []) {
    if (!item || !item.id) continue;
    const previo = mapa.get(item.id);
    if (!previo) {
      mapa.set(item.id, item);
      continue;
    }
    mapa.set(item.id, combinar(item, previo, camposCriticos));
  }

  return Array.from(mapa.values());
}

// ---- Fusion de los datos de cobro (clabe, banco, beneficiario...) ----
// Gana la version mas nueva, pero si ahi falta un dato (clabe vacia, por
// ejemplo) se conserva el de la otra version: la clabe es lo que mas cuesta
// perder.
function fusionarSettings(viejo, nuevo) {
  const pv = (viejo && viejo.settings) || {};
  const pn = (nuevo && nuevo.settings) || {};
  const out = { ...pv, ...pn };

  for (const clave of ['clabe', 'bank', 'beneficiary', 'concept', 'inviteLink']) {
    const valor = out[clave];
    if (typeof valor !== 'string' || valor.trim() === '') {
      const alterno = pv[clave];
      if (typeof alterno === 'string' && alterno.trim() !== '') out[clave] = alterno;
    }
  }
  return out;
}

// ---- Fusiona dos bases: "nuevo" es la mas reciente ----
function fusionarDos(viejo, nuevo) {
  const fusion = {
    users: unir('users', viejo, nuevo, ['password', 'passwordHash']),
    deposits: unir('deposits', viejo, nuevo),
    withdrawals: unir('withdrawals', viejo, nuevo),
    referralClaims: unir('referralClaims', viejo, nuevo),
    settings: fusionarSettings(viejo, nuevo),
    savedAt: (nuevo && nuevo.savedAt) || new Date().toISOString()
  };

  // El id del mensaje de Telegram donde se guarda la base se conserva.
  const id = (nuevo && nuevo.telegramMessageId) || (viejo && viejo.telegramMessageId);
  if (id) fusion.telegramMessageId = id;

  return fusion;
}

// ---- Fusiona varias bases de una vez (de la mas vieja a la mas nueva) ----
function fusionar(...bases) {
  const validas = bases.filter(esBaseValida).sort((a, b) => timestamp(a) - timestamp(b));
  if (!validas.length) return null;

  let resultado = null;
  for (const base of validas) {
    resultado = resultado ? fusionarDos(resultado, base) : base;
  }

  resultado.savedAt = new Date().toISOString();
  return resultado;
}

// ============================================================
//  Restaurar
// ============================================================

async function restaurar() {
  const local = leerLocal();
  const idTelegram = obtenerIdCheckpoint(local);
  const avisos = [];

  // ---- 1) Telegram (el almacen principal) ----
  let desdeTelegram = null;
  if (idTelegram) {
    const r = await telegram.leerBase(idTelegram);
    if (r.ok) {
      try {
        const db = JSON.parse(r.contenido.toString('utf-8'));
        if (esBaseValida(db)) {
          desdeTelegram = db;
          log('Base de datos restaurada de Telegram (' + db.users.length + ' usuarios).');
        } else {
          avisos.push('El documento de Telegram no parece una base de datos valida.');
        }
      } catch (e) {
        avisos.push('El documento de Telegram no se pudo leer como JSON.');
      }
    } else {
      avisos.push('Telegram: ' + r.motivo);
    }
  }

  // ---- 2) La rama "data" del repo (respaldo) ----
  let desdeRama = null;
  if (LECTURA_ACTIVA) {
    const r = await leerRemoto();
    if (r.ok && r.datos && esBaseValida(r.datos)) {
      desdeRama = r.datos;
    } else if (!r.ok) {
      avisos.push('Rama "' + BRANCH + '": ' + r.motivo);
    }
  }

  // ---- 3) Fusion de todo lo que se tiene ----
  const fusion = fusionar(desdeRama, desdeTelegram, local);

  if (!fusion) {
    warn('No se encontro ninguna copia de la base de datos para restaurar.');
    return { ok: false, motivo: 'sin copias' };
  }

  // El id del checkpoint se guarda en la base local para el proximo arranque.
  const idFinal = fusion.telegramMessageId || idTelegram || (desdeTelegram && desdeTelegram.telegramMessageId);
  if (idFinal) fusion.telegramMessageId = idFinal;

  escribirLocal(fusion);
  log('Base de datos restaurada (' + fusion.users.length + ' usuarios, clabe ' + fusion.settings.clabe + ').');
  if (avisos.length) avisos.forEach((a) => warn(a));

  return { ok: true, usuarios: fusion.users.length, avisos };
}

// ============================================================
//  Guardar
// ============================================================

async function guardarAhora() {
  const local = leerLocal();
  if (!local) return { ok: false, motivo: 'data.json local ausente o ilegible' };

  let ok = false;

  // ---- 1) Telegram: el almacen principal. No necesita ningun token. ----
  if (telegram.ACTIVO) {
    const id = obtenerIdCheckpoint(local);
    const contenido = Buffer.from(JSON.stringify(local, null, 2), 'utf-8');
    const caption = telegram.PREFIJO_CAPTION + ' | ' + local.savedAt +
      ' | ' + local.users.length + ' usuarios';

    const r = await telegram.guardarBase(contenido, id, caption);
    if (r.ok) {
      ok = true;
      if (r.message_id && r.message_id !== local.telegramMessageId) {
        // Se apunta en el archivo local (sin pasar por db.save(), para no
        // disparar otro guardado en cascada).
        local.telegramMessageId = r.message_id;
        escribirLocal(local);
      }
    } else {
      warn('No se pudo guardar la base de datos en Telegram:', r.motivo);
    }
  } else {
    warn('Sin TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID: la base de datos no se puede guardar.');
  }

  // ---- 2) La rama "data" del repo: respaldo (solo si hay token). ----
  if (ACTIVO) {
    const remoto = await leerRemoto();
    if (!remoto.ok) {
      warn('No se pudo leer la rama "' + BRANCH + '":', remoto.motivo);
      warn('No se sube nada: se evita pisar la base de datos remota.');
    } else {
      // Lo que se sube es la FUSION de lo local y lo remoto, nunca el local
      // solo: asi la rama "data" nunca pierde usuarios ni contrasenas.
      const fusion = fusionar(remoto.datos, local);
      const contenido = JSON.stringify(fusion, null, 2);

      if (Buffer.byteLength(contenido) > MAX_BYTES) {
        warn('data.json supera 1 MB: la API de GitHub no lo acepta.');
      } else {
        const base64 = Buffer.from(contenido, 'utf-8').toString('base64');
        if (await asegurarRama()) {
          ok = await subirContenido(base64);
        }
      }
    }
  } else if (!avisadoSinToken) {
    avisadoSinToken = true;
    warn('Sin GITHUB_TOKEN la rama "' + BRANCH + '" no se actualiza (la base se guarda igual en Telegram).');
  }

  return { ok };
}

// ---- Sube el contenido ya fusionado a la rama "data" ----
async function subirContenido(base64) {
  for (let intento = 0; intento < 3; intento++) {
    const actual = await api(`/repos/${REPO}/contents/${DB_REL}?ref=${BRANCH}`);
    const sha = actual.ok && actual.json ? actual.json.sha : undefined;
    const body = {
      message: `auto: base de datos AFXX (${new Date().toISOString()})`,
      content: base64,
      branch: BRANCH
    };
    if (sha) body.sha = sha;

    const put = await api(`/repos/${REPO}/contents/${DB_REL}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (put.ok) {
      log(`Base de datos subida a la rama "${BRANCH}".`);
      return true;
    }
    // 409/422 = el archivo cambio en GitHub entre medio: se reintenta.
    if (put.status === 409 || put.status === 422) {
      await sleep(1500);
      continue;
    }
    warn('No se pudo subir la base de datos:', put.status, (put.json && put.json.message) || '');
    return false;
  }
  warn('No se pudo subir la base de datos: conflictos repetidos.');
  return false;
}

async function asegurarRama() {
  // ¿La rama ya existe?
  const ref = await api(`/repos/${REPO}/git/ref/heads/${BRANCH}`);
  if (ref.ok) return true;

  // No existe: se crea desde la rama principal.
  const base = process.env.GITHUB_BASE_BRANCH || 'main';
  const baseRef = await api(`/repos/${REPO}/git/ref/heads/${base}`);
  if (!baseRef.ok || !baseRef.json || !baseRef.json.object) {
    warn(`No se pudo leer la rama "${base}" para crear "${BRANCH}".`);
    return false;
  }
  const put = await api(`/repos/${REPO}/git/refs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ref: `refs/heads/${BRANCH}`,
      sha: baseRef.json.object.sha
    })
  });
  if (put.ok) {
    log(`Rama "${BRANCH}" creada desde "${base}".`);
    return true;
  }
  // 422 = ya existe (otro proceso la creando). Es un OK para nuestros fines.
  if (put.status === 422) return true;
  warn(`No se pudo crear la rama "${BRANCH}":`, put.status, (put.json && put.json.message) || '');
  return false;
}

// ---- Agrupa los cambios: si llegan 20 registros seguidos, se sube una vez ----
function programarGuardado() {
  if (temporizador) clearTimeout(temporizador);
  temporizador = setTimeout(() => {
    temporizador = null;
    guardarAhora();
  }, 5000);
  if (temporizador.unref) temporizador.unref();
}

module.exports = {
  ACTIVO,
  LECTURA_ACTIVA,
  BRANCH,
  restaurar,
  guardarAhora,
  programarGuardado,
  fusionar
};
