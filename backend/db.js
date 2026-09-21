// Base de datos simple basada en un archivo JSON.
// Suficiente para pruebas y para el arranque real con volumen bajo/medio.
// Si más adelante el volumen crece mucho, esto se puede migrar a Postgres/MySQL
// sin cambiar la forma de las funciones de abajo (get/save), solo su implementación.

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.json');

function defaultData() {
  return {
    // IMPORTANTE: el campo de contraseña del usuario es "password" en TEXTO PLANO
    // (ver advertencia en routes/auth.js). El proyecto fue configurado así a
    // petición expresa del dueño, sabiendo que es inseguro.
    users: [],       // { id, contact, password, status, balance, rolloverRequired, rolloverWagered, createdAt }
    deposits: [],     // { id, userId, method, amount, bonusAccepted, bonusAmount, internalReference, status, createdAt, reviewedAt }
    withdrawals: [],  // { id, userId, accountHolder, bank, accountNumber, amount, status, createdAt, reviewedAt }
    // El usuario invitador manda el ID/contacto de su invitado (ya que el enlace
    // de invitación es el mismo para todos y no permite saber automáticamente
    // quién invitó a quién). El admin revisa y aprueba/rechaza a mano.
    referralClaims: [], // { id, userId, invitedContact, status, createdAt, reviewedAt }
    settings: {
      // Datos de pago que se muestran al usuario en la pantalla de depósito.
      // Se configuran desde el panel de admin (/admin), no por variables de entorno.
      clabe: '738180262552327957',
      bank: 'Fintoc',
      beneficiary: 'SPEI',
      concept: 'Pago',
      // Enlace único de invitación que se copia al portapapeles cuando el usuario
      // toca "Invita" en cualquier parte de la app. Es el mismo para todos los
      // usuarios y se configura desde el panel de admin. Si el admin nunca lo
      // cambió, se usa este valor por defecto para que la app nunca se quede
      // sin enlace.
      inviteLink: 'https://twa.afxx.mx/?ch=1270002',
      // Cuántos referidos válidos (aprobados por el admin) se necesitan para
      // llenar la barra del Cofre de Referidos en la pantalla de Afiliado.
      referralsRequired: 10
    }
  };
}

function load() {
  if (!fs.existsSync(DB_PATH)) {
    save(defaultData());
  }
  const raw = fs.readFileSync(DB_PATH, 'utf-8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error('data.json está corrupto o vacío, reiniciando con datos vacíos.');
    data = defaultData();
    save(data);
  }
  // Compatibilidad: bases de datos creadas antes de que existiera "settings".
  if (!data.settings) {
    data.settings = defaultData().settings;
    save(data);
    return data;
  }
  // Compatibilidad: bases de datos creadas antes de que existieran campos nuevos
  // en "settings" (ej. inviteLink). Si el admin nunca los tocó, los rellenamos
  // con los defaults para que la app no se quede sin valor al leerlos.
  let changed = false;
  const defaults = defaultData().settings;
  for (const key of Object.keys(defaults)) {
    if (typeof data.settings[key] === 'undefined') {
      data.settings[key] = defaults[key];
      changed = true;
    }
  }
  if (changed) save(data);

  // Compatibilidad: bases de datos creadas antes de que existiera "referralClaims".
  if (!Array.isArray(data.referralClaims)) {
    data.referralClaims = [];
    save(data);
  }
  return data;
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

module.exports = { load, save };
