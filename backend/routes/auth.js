const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { load, save } = require('../db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-cambia-esto';

// ADVERTENCIA DE SEGURIDAD (registrada a propósito, no la borres sin querer):
// Este proyecto guarda las contraseñas en TEXTO PLANO en backend/data.json.
// Eso significa que si alguien accede al archivo (respaldo filtrado, servidor
// comprometido, etc.) ve directamente los correos y contraseñas de todos los
// usuarios. El dueño del proyecto fue avisado de este riesgo y eligió este
// comportamiento de todas formas. Si en algún momento se decide cambiar a
// hashing (bcrypt/argon2), se debe:
//   1) reintroducir bcrypt aquí,
//   2) reescribir login para aceptar ambas formas (passwordHash legacy y
//      password plano de usuarios nuevos), y
//   3) re-hashear los registros existentes la próxima vez que cada usuario
//      entre a su cuenta.

// ---- Registro ----
router.post('/register', (req, res) => {
  const { contact, password } = req.body || {};
  if (!contact || !password) {
    return res.status(400).json({ error: 'Falta correo/teléfono o contraseña.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
  }

  const data = load();
  const exists = data.users.find(u => u.contact.toLowerCase() === contact.toLowerCase());
  if (exists) {
    return res.status(409).json({ error: 'Ya existe una cuenta con ese correo/teléfono.' });
  }

  // Texto plano a propósito (ver advertencia arriba).
  const user = {
    id: crypto.randomUUID(),
    contact,
    password, // <-- sin hash, guardado tal cual el usuario lo escribió
    status: 'active', // 'active' | 'blocked_fraud_review'
    balance: 0,
    rolloverRequired: 0,
    rolloverWagered: 0,
    createdAt: new Date().toISOString()
  };
  data.users.push(user);
  save(data);

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: publicUser(user) });
});

// ---- Login ----
router.post('/login', (req, res) => {
  const { contact, password } = req.body || {};
  if (!contact || !password) {
    return res.status(400).json({ error: 'Falta correo/teléfono o contraseña.' });
  }

  const data = load();
  const user = data.users.find(u => u.contact.toLowerCase() === contact.toLowerCase());
  if (!user) {
    return res.status(401).json({ error: 'Credenciales incorrectas.' });
  }

  // Comparación en texto plano. Soporta registros viejos que aún tengan
  // "passwordHash" con bcrypt — si lo encontramos, intentamos con bcrypt para
  // no dejar a nadie afuera durante la transición, y si coincide, lo migramos
  // al esquema nuevo (password plano). Las próximas cuentas se guardan planas
  // desde el principio.
  let passwordOk = false;
  if (typeof user.passwordHash === 'string' && user.passwordHash.length > 0) {
    // bcrypt es sync-required por la API bcrypt.compare — usamos require dinámico
    // solo si hace falta, para no penalizar el login normal en texto plano.
    try {
      const bcrypt = require('bcryptjs');
      passwordOk = bcrypt.compareSync(password, user.passwordHash);
      if (passwordOk) {
        // Migración silenciosa: lo pasamos al esquema "password" plano y
        // eliminamos el hash viejo. En el siguiente login ya no entra por aquí.
        delete user.passwordHash;
        user.password = password;
        save(data);
      }
    } catch (e) {
      passwordOk = false;
    }
  } else if (typeof user.password === 'string') {
    passwordOk = user.password === password;
  }

  if (!passwordOk) {
    return res.status(401).json({ error: 'Credenciales incorrectas.' });
  }

  if (user.status === 'blocked_fraud_review') {
    return res.status(403).json({ error: 'Esta cuenta está bloqueada para revisión. Contacta a soporte.' });
  }

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: publicUser(user) });
});

function publicUser(u) {
  // Nunca devolver el campo "password" al frontend, ni siquiera al admin.
  return {
    id: u.id,
    contact: u.contact,
    status: u.status,
    balance: u.balance,
    rolloverRequired: u.rolloverRequired,
    rolloverWagered: u.rolloverWagered,
    rolloverRemaining: Math.max(0, u.rolloverRequired - u.rolloverWagered)
  };
}

module.exports = { router, publicUser, JWT_SECRET };
