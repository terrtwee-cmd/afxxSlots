require('dotenv').config({
  path: require('path').join(__dirname, '.env')
});

const express = require('express');
const cors = require('cors');
const path = require('path');

const { router: authRouter } = require('./routes/auth');
const walletRouter = require('./routes/wallet');
const adminRouter = require('./routes/admin');
const sportsRouter = require('./routes/sports');
const inviteRouter = require('./routes/invite');
const persistencia = require('./persistencia');
const backupTelegram = require('../backup_telegram');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api', authRouter);
app.use('/api', walletRouter);
app.use('/api', inviteRouter);
app.use('/api/admin', adminRouter);
app.use('/api/sports', sportsRouter);

const ADMIN_PATH = '/' + (process.env.ADMIN_PATH || 'admin').replace(/^\/+/, '');

app.use(
  ADMIN_PATH,
  express.static(path.join(__dirname, 'public'))
);

app.use(
  express.static(path.join(__dirname, '..', 'frontend'))
);

app.get('/', (req, res) => {
  res.sendFile(
    path.join(__dirname, '..', 'frontend', 'index.html')
  );
});

const PORT = process.env.PORT || 4000;

// ---- Arranque ----
// 1) Se restaura la base de datos desde la rama "data" de GitHub (si esta
//    configurada). Sin esto, en cada reinicio se perdian la CLABE y los
//    usuarios registrados desde el ultimo despliegue.
// 2) Se sube la version actual a esa rama, para tener siempre una copia.
// 3) Solo despues empiezan los backups a Telegram, para que el primer archivo
//    enviado ya traiga la base de datos completa.
async function arrancar() {
  try {
    await persistencia.restaurar();
  } catch (e) {
    console.warn('[PERSISTENCIA] No se pudo restaurar la base de datos:', e.message);
  }

  try {
    await persistencia.guardarAhora();
  } catch (e) {
    console.warn('[PERSISTENCIA] No se pudo subir la base de datos:', e.message);
  }

  backupTelegram.iniciar();

  app.listen(PORT, () => {
    console.log(`AFXX backend escuchando en http://localhost:${PORT}`);
    console.log(`Panel de admin: http://localhost:${PORT}${ADMIN_PATH}`);
  });
}

arrancar();
