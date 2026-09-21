require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const { router: authRouter } = require('./routes/auth');
const walletRouter = require('./routes/wallet');
const adminRouter = require('./routes/admin');
const sportsRouter = require('./routes/sports');
const inviteRouter = require('./routes/invite');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', authRouter);
app.use('/api', walletRouter);
app.use('/api', inviteRouter);
app.use('/api/admin', adminRouter);
app.use('/api/sports', sportsRouter);

// Panel de admin (página estática simple, servida por el mismo backend).
// La ruta NO es "/admin" fijo — se lee de ADMIN_PATH en .env, para que no sea
// adivinable por alguien que solo prueba rutas obvias. Cámbiala en tu .env.
const ADMIN_PATH = '/' + (process.env.ADMIN_PATH || 'admin').replace(/^\/+/, '');
app.use(ADMIN_PATH, express.static(path.join(__dirname, 'public')));

// Frontend (la app en sí). Se sirve desde aquí mismo para que todo viva en
// un solo puerto — importante si vas a exponerlo con cloudflared/ngrok, así
// no necesitas un túnel separado para el frontend y otro para la API.
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`AFXX backend escuchando en http://localhost:${PORT}`);
  console.log(`Panel de admin: http://localhost:${PORT}${ADMIN_PATH}`);
});
