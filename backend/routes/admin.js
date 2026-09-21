const express = require('express');
const { load, save } = require('../db');
const { requireAdmin } = require('../middleware');

const router = express.Router();

const BONUS_PERCENT = Number(process.env.BONUS_PERCENT || 100);
const BONUS_MULTIPLIER = Number(process.env.BONUS_MULTIPLIER || 9);

// ---- Configuración de depósito (Clabe/banco/beneficiario/concepto) ----
// Esto es lo que ve el usuario en la pantalla de depósito. Se guarda en
// backend/data.json, no en variables de entorno, para poder cambiarlo sin
// reiniciar el servidor.
router.get('/settings', requireAdmin, (req, res) => {
  const data = load();
  res.json({ settings: data.settings });
});

router.post('/settings', requireAdmin, (req, res) => {
  const { clabe, bank, beneficiary, concept, inviteLink, referralsRequired } = req.body || {};
  if (!clabe || !bank) {
    return res.status(400).json({ error: 'Faltan datos (Clabe y banco son obligatorios).' });
  }
  const data = load();
  data.settings = {
    clabe: String(clabe).trim(),
    bank: String(bank).trim(),
    beneficiary: beneficiary ? String(beneficiary).trim() : data.settings.beneficiary,
    concept: concept ? String(concept).trim() : data.settings.concept,
    inviteLink: inviteLink !== undefined && inviteLink !== null
      ? String(inviteLink).trim()
      : (data.settings.inviteLink || ''),
    referralsRequired: referralsRequired !== undefined && referralsRequired !== null && String(referralsRequired).trim() !== ''
      ? Math.max(1, Number(referralsRequired))
      : (data.settings.referralsRequired || 10)
  };
  save(data);
  res.json({ settings: data.settings });
});

// ---- Lista de solicitudes de depósito ----
router.get('/deposits', requireAdmin, (req, res) => {
  const data = load();
  const list = data.deposits
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(d => {
      const user = data.users.find(u => u.id === d.userId);
      return { ...d, userContact: user ? user.contact : '(usuario eliminado)' };
    });
  res.json({ deposits: list });
});

// ---- Autorizar depósito: aquí se acredita el saldo y el rollover, una vez
// que el admin comprobó a mano que el pago realmente llegó ----
router.post('/deposits/:id/authorize', requireAdmin, (req, res) => {
  const data = load();
  const d = data.deposits.find(x => x.id === req.params.id);
  if (!d) return res.status(404).json({ error: 'Solicitud no encontrada.' });
  if (d.status !== 'pending') return res.status(400).json({ error: 'Esta solicitud ya fue resuelta.' });

  const user = data.users.find(u => u.id === d.userId);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

  let bonusAmount = 0;
  let rolloverAdd = d.amount; // sin bono: 1x el depósito

  if (d.bonusAccepted) {
    bonusAmount = d.amount * (BONUS_PERCENT / 100);
    rolloverAdd = d.amount + bonusAmount * BONUS_MULTIPLIER;
  }

  user.balance += d.amount + bonusAmount;
  user.rolloverRequired += rolloverAdd;

  d.bonusAmount = bonusAmount;
  d.status = 'authorized';
  d.reviewedAt = new Date().toISOString();
  save(data);
  res.json({ deposit: d });
});

// ---- Rechazar depósito (el pago nunca llegó / no coincide) ----
router.post('/deposits/:id/reject', requireAdmin, (req, res) => {
  const data = load();
  const d = data.deposits.find(x => x.id === req.params.id);
  if (!d) return res.status(404).json({ error: 'Solicitud no encontrada.' });
  if (d.status !== 'pending') return res.status(400).json({ error: 'Esta solicitud ya fue resuelta.' });

  d.status = 'rejected';
  d.reviewedAt = new Date().toISOString();
  save(data);
  res.json({ deposit: d });
});

// ---- Referidos manuales: el usuario manda el ID/contacto de su invitado,
// el admin revisa y aprueba/rechaza a mano (ver routes/invite.js) ----
router.get('/referral-claims', requireAdmin, (req, res) => {
  const data = load();
  const list = data.referralClaims
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(c => {
      const user = data.users.find(u => u.id === c.userId);
      return { ...c, userContact: user ? user.contact : '(usuario eliminado)' };
    });
  res.json({ claims: list });
});

router.post('/referral-claims/:id/approve', requireAdmin, (req, res) => {
  const data = load();
  const c = data.referralClaims.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Solicitud no encontrada.' });
  if (c.status !== 'pending') return res.status(400).json({ error: 'Esta solicitud ya fue resuelta.' });
  c.status = 'approved';
  c.reviewedAt = new Date().toISOString();
  save(data);
  res.json({ claim: c });
});

router.post('/referral-claims/:id/reject', requireAdmin, (req, res) => {
  const data = load();
  const c = data.referralClaims.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Solicitud no encontrada.' });
  if (c.status !== 'pending') return res.status(400).json({ error: 'Esta solicitud ya fue resuelta.' });
  c.status = 'rejected';
  c.reviewedAt = new Date().toISOString();
  save(data);
  res.json({ claim: c });
});

// ---- Lista de solicitudes de retiro ----
router.get('/withdrawals', requireAdmin, (req, res) => {
  const data = load();
  const list = data.withdrawals
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(w => {
      const user = data.users.find(u => u.id === w.userId);
      return { ...w, userContact: user ? user.contact : '(usuario eliminado)' };
    });
  res.json({ withdrawals: list });
});

// ---- Autorizar ----
router.post('/withdrawals/:id/authorize', requireAdmin, (req, res) => {
  const data = load();
  const w = data.withdrawals.find(x => x.id === req.params.id);
  if (!w) return res.status(404).json({ error: 'Solicitud no encontrada.' });
  if (w.status !== 'pending') return res.status(400).json({ error: 'Esta solicitud ya fue resuelta.' });

  w.status = 'authorized';
  w.reviewedAt = new Date().toISOString();
  save(data);
  res.json({ withdrawal: w });
});

// ---- Regresar fondos a la cuenta del usuario ----
router.post('/withdrawals/:id/return', requireAdmin, (req, res) => {
  const data = load();
  const w = data.withdrawals.find(x => x.id === req.params.id);
  if (!w) return res.status(404).json({ error: 'Solicitud no encontrada.' });
  if (w.status !== 'pending') return res.status(400).json({ error: 'Esta solicitud ya fue resuelta.' });

  const user = data.users.find(u => u.id === w.userId);
  if (user) user.balance += w.amount;

  w.status = 'returned';
  w.reviewedAt = new Date().toISOString();
  save(data);
  res.json({ withdrawal: w });
});

// ---- Alerta de fraude: bloquea al usuario sin borrar la cuenta ----
router.post('/withdrawals/:id/fraud', requireAdmin, (req, res) => {
  const data = load();
  const w = data.withdrawals.find(x => x.id === req.params.id);
  if (!w) return res.status(404).json({ error: 'Solicitud no encontrada.' });
  if (w.status !== 'pending') return res.status(400).json({ error: 'Esta solicitud ya fue resuelta.' });

  const user = data.users.find(u => u.id === w.userId);
  if (user) user.status = 'blocked_fraud_review'; // la cuenta sigue existiendo, solo queda inaccesible

  w.status = 'fraud_flagged';
  w.reviewedAt = new Date().toISOString();
  save(data);
  res.json({ withdrawal: w });
});

// ---- Desbloquear una cuenta después de revisarla a mano ----
router.post('/users/:id/unblock', requireAdmin, (req, res) => {
  const data = load();
  const user = data.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
  user.status = 'active';
  save(data);
  const { password, ...safe } = user;
  res.json({ user: safe });
});

// ---- Lista de usuarios bloqueados (para revisión manual) ----
router.get('/users/blocked', requireAdmin, (req, res) => {
  const data = load();
  const blocked = data.users
    .filter(u => u.status === 'blocked_fraud_review')
    .map(({ password, ...safe }) => safe); // nunca exponer la contraseña, ni siquiera al admin
  res.json({ users: blocked });
});

module.exports = router;
