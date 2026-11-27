// ============================================================
//  PERSISTENCIA DE LA BASE DE DATOS (fuera del disco efimero)
// ============================================================
//  El problema que arregla esto:
//
//  En Render (plan gratuito) el disco del contenedor se borra en cada
//  despliegue o reinicio. Como backend/data.json vive DENTRO del repo, al
//  re-clonar el repo el archivo vuelve al estado del ultimo commit. En la
//  practica eso significaba:
//
//    - la CLABE configurada desde /admin se perdia en cada reinicio, y
//    - los usuarios (con sus contrasenas) registrados desde el ultimo
//      despliegue desaparecian del servidor, y
//    - el backup a Telegram seguia mandando el mismo archivo incompleto.
//
//  La solucion: la rama "data" del repo guarda la foto real de la base de
//  datos. Al arrancar el servidor la restaura; al guardar, sube la version
//  nueva. La rama es independiente de "main", asi que subir la base de datos
//  NO dispara un redespliegue de la app.
//
//  Se activa con estas variables de entorno (en Render -> Environment):
//
//    GITHUB_TOKEN = un PAT con permiso de escritura en el repo
//    GITHUB_REPO  = terrtwee-cmd/afxxSlots
//
//  Sin esas dos variables, nada cambia: el servidor sigue funcionando
//  exactamente igual que antes (solo que sin persistencia extra).
// ============================================================

const fs = require('fs');
const path = require('path');

const BACKEND_DIR = __dirname;
const REPO_DIR = path.join(BACKEND_DIR, '..');
const DB_REL = 'backend/data.json';
const DB_PATH = path.join(BACKEND_DIR, 'data.json');

const TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = process.env.GITHUB_REPO || '';
const BRANCH = process.env.GITHUB_DATA_BRANCH || 'data';
const ACTIVO = Boolean(TOKEN && REPO);

const API = 'https://api.github.com';
const TIMEOUT_MS = 20000;
// La API de "contents" de GitHub no acepta archivos de mas de ~1 MB.
const MAX_BYTES = 900 * 1024;

let temporizador = null;

function log(...args) { console.log('[PERSISTENCIA]', ...args); }
function warn(...args) { console.warn('[PERSISTENCIA]', ...args); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(ruta, opciones = {}) {
  const res = await fetch(API + ruta, {
    ...opciones,
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'afxx-server',
      ...(opciones.headers || {})
    },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  const texto = await res.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch (e) { /* respuesta no JSON */ }
  return { ok: res.ok, status: res.status, json };
}

// Which version is newer: the one with the most recent savedAt; if they tie,
// the one with more users.
function esMasNueva(candidata, actual) {
  const ta = Date.parse(candidata.savedAt || '') || 0;
  const tb = Date.parse(actual.savedAt || '') || 0;
  if (ta !== tb) return ta > tb;
  const na = (candidata.users || []).length;
  const nb = (actual.users || []).length;
  return na > nb;
}

// ---- Restaura la base de datos desde la rama "data" ----
async function restaurar() {
  if (!ACTIVO) {
    log('Sin GITHUB_TOKEN/GITHUB_REPO: la base de datos NO se guarda fuera del disco (igual que antes).');
    return false;
  }
  try {
    const res = await api(`/repos/${REPO}/contents/${DB_REL}?ref=${BRANCH}`);
    if (res.status === 404) {
      log(`Todavia no hay base de datos en la rama "${BRANCH}": se usa el archivo local.`);
      return false;
    }
    if (!res.ok) {
      warn(`GitHub respondio ${res.status} al leer la rama "${BRANCH}".`);
      return false;
    }

    const remoto = JSON.parse(Buffer.from(res.json.content, 'base64').toString('utf-8'));
    let local = null;
    if (fs.existsSync(DB_PATH)) {
      try { local = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8')); } catch (e) { local = null; }
    }

    if (!local) {
      fs.writeFileSync(DB_PATH, JSON.stringify(remoto, null, 2), 'utf-8');
      log('Base de datos restaurada desde la rama "' + BRANCH + '".');
      return true;
    }
    if (esMasNueva(remoto, local)) {
      fs.writeFileSync(DB_PATH, JSON.stringify(remoto, null, 2), 'utf-8');
      log(`Base de datos restaurada desde la rama "${BRANCH}" (era mas reciente).`);
      return true;
    }
    log('La base de datos local ya es la mas reciente.');
    return false;
  } catch (err) {
    warn('No se pudo restaurar la base de datos desde GitHub:', err.message);
    return false;
  }
}

// ---- Sube la base de datos actual a la rama "data" ----
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

async function guardarAhora() {
  if (!ACTIVO) return false;
  try {
    if (!fs.existsSync(DB_PATH)) return false;
    const contenido = fs.readFileSync(DB_PATH, 'utf-8');
    if (Buffer.byteLength(contenido) > MAX_BYTES) {
      warn('data.json supera 1 MB: la API de GitHub no lo acepta. Se necesita un disco persistente.');
      return false;
    }
    const base64 = Buffer.from(contenido, 'utf-8').toString('base64');

    if (!await asegurarRama()) return false;

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
  } catch (err) {
    warn('Error al subir la base de datos a GitHub:', err.message);
    return false;
  }
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

module.exports = { ACTIVO, BRANCH, restaurar, guardarAhora, programarGuardado };
