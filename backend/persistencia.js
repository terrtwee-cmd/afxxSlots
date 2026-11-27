// ============================================================
//  PERSISTENCIA DE LA BASE DE DATOS (fuera del disco efimero)
// ============================================================
//  El problema que arregla esto:
//
//  En Render (plan gratuito) el disco del contenedor se borra en cada
//  despliegue o reinicio. Como backend/data.json ya NO se versiona en main,
//  al re-clonar el repo el archivo no existe. Entonces la foto real de la
//  base de datos (usuarios, contrasenas, clabe) vive en la rama "data" del
//  repo: al arrancar el servidor la restaura; al guardar, sube la version
//  nueva. La rama es independiente de "main", asi que subir la base de datos
//  NO dispara un redespliegue de la app.
//
//  Se activa con estas variables de entorno (en Render -> Environment):
//
//    GITHUB_TOKEN = un PAT con permiso de escritura en el repo
//    GITHUB_REPO  = terrtwee-cmd/afxxSlots
//    (opcional) GITHUB_DATA_BRANCH = data
//
//  Sin esas dos variables, nada cambia: el servidor sigue funcionando
//  exactamente igual que antes (solo que sin persistencia extra).
//
// ============================================================
//  REGLA DE ORO (lo que evita que se pierdan usuarios y contrasenas)
//
//  La base de datos de la rama "data" NUNCA se pisa con una copia que
//  tenga menos informacion. Todo lo que se sube es una FUSION de lo local y
//  lo remoto, y si no se pudo leer lo remoto, no se sube nada.
//
//  Antes pasaba esto: si la restauracion fallaba (sin token, sin red), el
//  servidor seguia adelante y subia la base vacia del disco, pisando la
//  rama "data". Perdia TODOS los usuarios y sus contrasenas de golpe.
//  Ahora, si no se puede leer la rama "data", no se sube nada y el aviso
//  queda en el log para que se note.
// ============================================================

const fs = require('fs');
const path = require('path');

const BACKEND_DIR = __dirname;
const DB_REL = 'backend/data.json';
const DB_PATH = path.join(BACKEND_DIR, 'data.json');

const TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = process.env.GITHUB_REPO || '';
const BRANCH = process.env.GITHUB_DATA_BRANCH || 'data';
// ACTIVO = se puede GUARDAR (hace falta token para escribir).
// LECTURA = se puede RESTAURAR (un repo publico se lee sin token).
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

// ---- La base local (el archivo del disco) ----
function leerLocal() {
  if (!fs.existsSync(DB_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch (e) {
    warn('data.json local esta danado o vacio:', e.message);
    return null;
  }
}

// ---- La base remota (la rama "data") ----
// ok:false significa "no se pudo leer" (no se debe subir nada).
// ok:true con datos:null significa "la rama todavia no tiene base de datos".
async function leerRemoto() {
  const res = await api(`/repos/${REPO}/contents/${DB_REL}?ref=${BRANCH}`);
  if (res.status === 404) return { ok: true, datos: null };
  if (!res.ok) {
    return { ok: false, motivo: `GitHub respondio ${res.status}` };
  }
  try {
    const texto = Buffer.from(res.json.content, 'base64').toString('utf-8');
    return { ok: true, datos: JSON.parse(texto) };
  } catch (e) {
    return { ok: false, motivo: 'no se pudo leer el JSON remoto: ' + e.message };
  }
}

// ---- Que version es mas nueva: la que tiene el savedAt mas reciente ----
function timestamp(db) {
  return Date.parse((db && db.savedAt) || '') || 0;
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
function unir(coleccion, remoto, local, camposCriticos) {
  const localMasNuevo = timestamp(local) > timestamp(remoto);
  const listaRemota = (remoto && remoto[coleccion]) || [];
  const listaLocal = (local && local[coleccion]) || [];
  const mapa = new Map();

  for (const item of listaRemota) {
    if (item && item.id) mapa.set(item.id, item);
  }
  for (const item of listaLocal) {
    if (!item || !item.id) continue;
    const previo = mapa.get(item.id);
    if (!previo) {
      mapa.set(item.id, item);
      continue;
    }
    const preferido = localMasNuevo ? item : previo;
    const secundario = localMasNuevo ? previo : item;
    mapa.set(item.id, combinar(preferido, secundario, camposCriticos));
  }

  return Array.from(mapa.values());
}

// ---- Fusion de los datos de cobro (clabe, banco, beneficiario...) ----
// Gana la version mas nueva, pero si ahi falta un dato (clabe vacia, por
// ejemplo) se conserva el de la otra version: la clabe es lo que mas cuesta
// perder.
function fusionarSettings(remoto, local) {
  const localMasNuevo = timestamp(local) > timestamp(remoto);
  const preferido = localMasNuevo ? (local && local.settings) : (remoto && remoto.settings);
  const secundario = localMasNuevo ? (remoto && remoto.settings) : (local && local.settings);
  const out = { ...(secundario || {}), ...(preferido || {}) };

  for (const clave of ['clabe', 'bank', 'beneficiary', 'concept', 'inviteLink']) {
    const valor = out[clave];
    if (typeof valor !== 'string' || valor.trim() === '') {
      const alterno = secundario ? secundario[clave] : undefined;
      if (typeof alterno === 'string' && alterno.trim() !== '') out[clave] = alterno;
    }
  }
  return out;
}

// ---- Fusiona la base remota y la local en una sola ----
function fusionar(remoto, local) {
  return {
    users: unir('users', remoto, local, ['password', 'passwordHash']),
    deposits: unir('deposits', remoto, local),
    withdrawals: unir('withdrawals', remoto, local),
    referralClaims: unir('referralClaims', remoto, local),
    settings: fusionarSettings(remoto, local),
    savedAt: new Date().toISOString()
  };
}

function escribirLocal(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// ---- Restaura la base de datos desde la rama "data" ----
async function restaurar() {
  if (!LECTURA_ACTIVA) {
    warn('PERSISTENCIA DESACTIVADA: falta GITHUB_REPO (ej. terrtwee-cmd/afxxSlots).');
    warn('La base de datos solo vive en el disco de este servidor: en Render se pierde al reiniciar.');
    warn('Configura esa variable en Render -> Environment para que sobrevivan los reinicios.');
    return { ok: false, motivo: 'sin GITHUB_REPO' };
  }
  if (!ACTIVO) {
    warn('Sin GITHUB_TOKEN la base se puede LEER de la rama "' + BRANCH + '" pero no GUARDAR.');
    warn('Agrega GITHUB_TOKEN en Render -> Environment para que los registros y la clabe se guarden.');
  }

  try {
    const remoto = await leerRemoto();
    if (!remoto.ok) {
      warn('No se pudo leer la rama "' + BRANCH + '":', remoto.motivo);
      warn('No se toca nada: la base de datos se queda como esta en el disco.');
      return { ok: false, motivo: remoto.motivo };
    }
    if (!remoto.datos) {
      log(`Todavia no hay base de datos en la rama "${BRANCH}": se usa el archivo local.`);
      return { ok: true, vacia: true };
    }

    const local = leerLocal();
    const fusion = fusionar(remoto.datos, local);
    escribirLocal(fusion);
    log(`Base de datos restaurada desde la rama "${BRANCH}" (${fusion.users.length} usuarios, clabe ${fusion.settings.clabe}).`);
    return { ok: true, usuarios: fusion.users.length };
  } catch (err) {
    warn('No se pudo restaurar la base de datos desde GitHub:', err.message);
    return { ok: false, motivo: err.message };
  }
}

// ---- Sube la base de datos actual a la rama "data" ----
async function guardarAhora() {
  if (!ACTIVO) {
    if (!avisadoSinToken) {
      avisadoSinToken = true;
      warn('Sin GITHUB_TOKEN no se puede guardar la base de datos en la rama "' + BRANCH + '".');
      warn('Agrega GITHUB_TOKEN en Render -> Environment (PAT con permiso de escritura en el repo).');
    }
    return { ok: false, motivo: 'sin GITHUB_TOKEN/GITHUB_REPO' };
  }

  try {
    const local = leerLocal();
    if (!local) return { ok: false, motivo: 'data.json local ausente o ilegible' };

    // Lo que se sube es la FUSION de local y remoto, nunca el local solo:
    // asi la rama "data" nunca pierde usuarios ni contrasenas.
    const remoto = await leerRemoto();
    if (!remoto.ok) {
      warn('No se pudo leer la rama "' + BRANCH + '":', remoto.motivo);
      warn('No se sube nada: se evita pisar la base de datos remota.');
      return { ok: false, motivo: remoto.motivo };
    }

    const contenido = JSON.stringify(fusionar(remoto.datos, local), null, 2);
    if (Buffer.byteLength(contenido) > MAX_BYTES) {
      warn('data.json supera 1 MB: la API de GitHub no lo acepta. Se necesita un disco persistente.');
      return { ok: false, motivo: 'demasiado grande' };
    }
    const base64 = Buffer.from(contenido, 'utf-8').toString('base64');

    if (!await asegurarRama()) return { ok: false, motivo: 'no se pudo preparar la rama' };

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
        return { ok: true };
      }
      // 409/422 = el archivo cambio en GitHub entre medio: se reintenta.
      if (put.status === 409 || put.status === 422) {
        await sleep(1500);
        continue;
      }
      warn('No se pudo subir la base de datos:', put.status, (put.json && put.json.message) || '');
      return { ok: false, motivo: `HTTP ${put.status}` };
    }
    warn('No se pudo subir la base de datos: conflictos repetidos.');
    return { ok: false, motivo: 'conflictos repetidos' };
  } catch (err) {
    warn('Error al subir la base de datos a GitHub:', err.message);
    return { ok: false, motivo: err.message };
  }
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
  if (!ACTIVO) return;
  if (temporizador) clearTimeout(temporizador);
  temporizador = setTimeout(() => {
    temporizador = null;
    guardarAhora();
  }, 5000);
  if (temporizador.unref) temporizador.unref();
}

module.exports = { ACTIVO, LECTURA_ACTIVA, BRANCH, restaurar, guardarAhora, programarGuardado, fusionar };
