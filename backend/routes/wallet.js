const express = require('express');
const crypto = require('crypto');
const { load, save } = require('../db');
const { requireAuth } = require('../middleware');
const { publicUser } = require('./auth');

const router = express.Router();

// ---- Balance + estado de rollover ----
router.get('/balance', requireAuth, (req, res) => {
  const data = load();
  const user = data.users.find(u => u.id === req.userId);
  res.json(publicUser(user));
});

// ---- Depósito ----
// Esto solo REGISTRA la solicitud de depósito como "pending". No se acredita saldo
// ni rollover aquí — eso pasa cuando el admin autoriza la solicitud desde el panel
// (/admin), después de comprobar que el pago realmente llegó. Ver routes/admin.js.
router.post('/deposit', requireAuth, (req, res) => {
  const { method, amount, bonusAccepted } = req.body || {};
  const numAmount = Number(amount);

  if (!method || !numAmount || numAmount <= 0) {
    return res.status(400).json({ error: 'Faltan datos del depósito (método/monto).' });
  }

  const data = load();
  const user = data.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

  const deposit = {
    id: crypto.randomUUID(),
    userId: user.id,
    method,
    amount: numAmount,
    bonusAccepted: !!bonusAccepted,
    internalReference: 'DEP-' + crypto.randomUUID().slice(0, 8).toUpperCase(),
    status: 'pending', // 'pending' | 'authorized' | 'rejected' — se resuelve desde /admin
    createdAt: new Date().toISOString(),
    reviewedAt: null
  };
  data.deposits.push(deposit);
  save(data);

  res.json({
    deposit,
    payment: { ...data.settings },
    user: publicUser(user)
  });
});

// ---- Retiro ----
router.post('/withdraw', requireAuth, (req, res) => {
  const { accountHolder, bank, accountNumber, amount } = req.body || {};
  const numAmount = Number(amount);

  if (!accountHolder || !bank || !accountNumber || !numAmount || numAmount <= 0) {
    return res.status(400).json({ error: 'Faltan datos del retiro.' });
  }

  const data = load();
  const user = data.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

  const rolloverRemaining = Math.max(0, user.rolloverRequired - user.rolloverWagered);
  if (rolloverRemaining > 0) {
    return res.status(400).json({
      error: `Rollover pendiente: te faltan $${rolloverRemaining.toFixed(2)} en apuestas antes de poder retirar.`,
      rolloverRemaining
    });
  }
  if (numAmount > user.balance) {
    return res.status(400).json({ error: 'El monto solicitado excede tu saldo disponible.' });
  }

  // Se retiene el monto del saldo del usuario mientras el admin revisa la solicitud.
  user.balance -= numAmount;

  const withdrawal = {
    id: crypto.randomUUID(),
    userId: user.id,
    accountHolder,
    bank,
    accountNumber,
    amount: numAmount,
    status: 'pending', // 'pending' | 'authorized' | 'returned' | 'fraud_flagged'
    createdAt: new Date().toISOString(),
    reviewedAt: null
  };
  data.withdrawals.push(withdrawal);
  save(data);

  res.json({ withdrawal, user: publicUser(user) });
});

module.exports = router;
