// ---- Enlace de invitación (público) ----
// Devuelve el enlace único configurado por el admin en el panel (/admin),
// que es el mismo para todos los usuarios. La app lo consume al renderizar
// los botones "Invita" / "Copiar" del frontend para no tener el enlace
// hardcodeado en el HTML.
//
// Es público a propósito: el enlace de invitación es justamente lo que el
// usuario va a compartir con amigos, así que esconderlo del lado del backend
// no aporta seguridad real. El admin puede rotarlo cuando quiera desde el
// panel.

const express = require('express');
const crypto = require('crypto');
const { load, save } = require('../db');
const { requireAuth } = require('../middleware');

const router = express.Router();

router.get('/invite-link', (req, res) => {
  const data = load();
  // Si por alguna razón el campo no existe (BD vieja), devolvemos string vacío
  // y el frontend usa su propio fallback para no romper la app.
  const inviteLink = (data.settings && data.settings.inviteLink) || '';
  res.json({ inviteLink });
});

// ---- Estado del Cofre de Referidos (barra de progreso) ----
// Cuenta cuántos de los "reclamos" de ESTE usuario ya fueron aprobados por
// el admin, contra cuántos hacen falta (settings.referralsRequired).
router.get('/referral-status', requireAuth, (req, res) => {
  const data = load();
  const required = (data.settings && data.settings.referralsRequired) || 10;
  const mine = data.referralClaims.filter(c => c.userId === req.userId);
  const approved = mine.filter(c => c.status === 'approved').length;
  res.json({
    approved,
    required,
    claims: mine
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  });
});

// ---- Enviar un invitado para revisión ----
// El usuario escribe el ID/contacto de su invitado que ya cumplió los
// requisitos (ver pestaña "Reglas"). Queda pendiente hasta que el admin lo
// revise en el panel.
router.post('/referral-claim', requireAuth, (req, res) => {
  const { invitedContact } = req.body || {};
  if (!invitedContact || !String(invitedContact).trim()) {
    return res.status(400).json({ error: 'Escribe el ID o contacto de tu invitado.' });
  }
  const data = load();
  const claim = {
    id: crypto.randomUUID(),
    userId: req.userId,
    invitedContact: String(invitedContact).trim(),
    status: 'pending', // 'pending' | 'approved' | 'rejected'
    createdAt: new Date().toISOString(),
    reviewedAt: null
  };
  data.referralClaims.push(claim);
  save(data);
  res.json({ claim });
});

module.exports = router;