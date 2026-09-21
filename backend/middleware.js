const jwt = require('jsonwebtoken');
const { load } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-cambia-esto';

// Autenticación de usuario normal (token JWT emitido en /register o /login)
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autenticado.' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const data = load();
    const user = data.users.find(u => u.id === payload.userId);
    if (!user) return res.status(401).json({ error: 'Usuario no encontrado.' });
    if (user.status === 'blocked_fraud_review') {
      return res.status(403).json({ error: 'Cuenta bloqueada para revisión. Contacta a soporte.' });
    }
    req.userId = user.id;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token inválido o expirado.' });
  }
}

// Autenticación simple para el panel de admin: una llave compartida en el header.
// No es una cuenta de usuario — es solo para ti, el operador.
function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (!key || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Llave de admin inválida.' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
