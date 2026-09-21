const express = require('express');
const router = express.Router();

// ---- Partidos / momios ----
// AHORA MISMO ESTO ES DATA DE EJEMPLO (mock). Cuando tengas el endpoint real de tu
// proveedor de momios/deportes (el mismo agregador que sirve las imágenes de los
// juegos), reemplaza el contenido de este arreglo por una llamada fetch/axios a ese
// endpoint real, manteniendo la misma forma de los objetos de abajo para no tener
// que tocar el frontend.
const MOCK_MATCHES = [
  {
    id: 'm1',
    league: 'Fútbol • Liga MX',
    hot: true,
    teamHome: 'Pumas Unam',
    teamAway: 'Club León',
    time: '21:05',
    date: '10/09/2026',
    odds: { home: '+106', draw: '+255', away: '+235' }
  },
  {
    id: 'm2',
    league: 'Fútbol • Liga MX',
    hot: false,
    teamHome: 'Tigres UANL',
    teamAway: 'Monterrey',
    time: '19:00',
    date: '11/09/2026',
    odds: { home: '+120', draw: '+240', away: '+190' }
  }
];

router.get('/matches', (req, res) => {
  // TODO: sustituir por la llamada real al proveedor de momios cuando tengas el
  // endpoint/credenciales. Mientras tanto, devuelve la data de ejemplo de arriba.
  res.json({ matches: MOCK_MATCHES });
});

module.exports = router;
