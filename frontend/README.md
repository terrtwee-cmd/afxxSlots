# AFXX — Frontend

Frontend de la app AFXX (casino online y apuestas). Identidad: **blanco + rojo**.

## Archivos

| Archivo | Qué contiene |
|---|---|
| `index.html` | App principal: header (invitado / con sesión), Inicio, Casino, Deportes, Afiliado, Menú, y todas las pantallas de depósito/retiro/cuenta |
| `login.html` | Pantalla de inicio de sesión |
| `register.html` | Pantalla de registro |
| `styles.css` | Todo el CSS compartido (variables, componentes, modales) |
| `app.js` | Navegación entre vistas, modales, llamadas al backend |
| `theme.js` | Motor de tema claro/oscuro: selector de primera visita, botón de cambio y persistencia |
| `assets/` | Imágenes: logo, mascota, banners, juegos, íconos de ranking |

## Cómo abrirlo

Opción 1 — abrir directamente:
```
doble-click en index.html
```

Opción 2 — servidor local (recomendado, evita problemas de rutas):
```bash
cd frontend
python3 -m http.server 8000
# abre http://localhost:8000
```

## Tema claro / oscuro

El fondo de todo el sitio es configurable y la preferencia se guarda en el navegador.

- Al entrar por primera vez se muestra un selector **antes del splash** (solo esa vez)
  con las opciones **Claro** y **Oscuro**; por defecto se arranca en **Oscuro**.
- El botón redondo de la barra superior (sol/luna) cambia el tema cuando quieras.
- La preferencia vive en `localStorage` bajo la clave `afxx_theme` y se aplica en las
  4 páginas (inicio, login, registro y panel de admin) sin parpadeo: cada página
  carga un script inline en el `<head>` que fija `data-theme` antes del primer pintado.
- Los colores se controlan con variables CSS en `:root`; el modo oscuro está en el
  bloque `[data-theme="dark"]` de `styles.css`.

## Estructura de assets

- `assets/logo.png` — logo principal (header)
- `assets/brand/` — moneda AFXX, banners hero, badges de ranking, ícono de WhatsApp
- `assets/mascot/` — mascota (axolotl) en distintas variantes
- `assets/games/` — miniaturas de juegos
- `assets/affiliate/` — cofre y burbujas de la sección Afiliados

## Deportes (API pública)

La pestaña **Deportes** ya consume datos reales. El backend (`backend/routes/sports.js`)
consulta **TheSportsDB** (JSON v1, sin registro; clave de prueba gratuita `123`) y
expone:

| Endpoint | Qué devuelve |
|---|---|
| `GET /api/sports/matches` | Próximos partidos (Liga MX primero) con escudos, hora de México y estado: en vivo / final / postponed |
| `GET /api/sports/table` | Tabla de posiciones de la Liga MX (PJ, G, E, P, DG, PTS) |

Detalles que conviene saber:

- La **API gratuita corta las ráfagas** (HTTP 429 de Cloudflare), así que el backend
  consulta los endpoints **uno tras otro** con una pausa entre ellos y guarda todo en
  **caché de 30 minutos**. Si un endpoint pide espera, se reintenta una vez según el
  `retry-after`; si la tanda sale incompleta se conserva el dato anterior y, en
  último caso, se sirven datos de ejemplo.
- Para usar una clave propia: `SPORTSDB_KEY=...` en `backend/.env`
  (sin tocar código). Otros ajustes: `SPORTS_CACHE_MINUTES`, `SPORTS_REQUEST_SPACING_MS`.
- La API pública **no trae momios**: los botones 1 / Empate / 2 salen con "—"
  en vez de inventar cuotas. Cuando exista el proveedor real de momios, se
  rellena el campo `odds` del backend y los botones ya funcionan solos.
- Al arrancar, el servidor **precalienta la caché** para que la primera visita a
  la pantalla no espere la consulta.

## Base de datos y reinicios

El disco de Render es efimero: en cada reinicio se borra. Para que no se
pierdan los usuarios, sus contraseñas ni la CLABE:

- La base de datos se guarda en **Telegram** (el bot), en un mensaje
  "checkpoint" que se actualiza en el lugar, así que siempre tiene la versión
  más reciente. Al arrancar, el servidor la restaura. Solo necesita
  `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID` — **ningún token de GitHub**.
- Cada registro nuevo te llega a Telegram con el usuario y la contraseña.
- `backend/data.json` **no** se versiona en `main`: la base real vive en el
  chat del bot (y, si quieres, también en la rama `data` del repo). En `main`
  solo queda `backend/data.base.json`, una plantilla sin usuarios ni
  contraseñas.
- Si el admin cambia la CLABE, se guarda en el acto: no se pierde al reiniciar.

## Pendiente (próximas conversaciones)

- Modelos de apuestas deportivas (cuotas reales del proveedor)
- Conexión de pasarela de pago real en backend

## Tipografías

Cargadas desde Google Fonts:
- **Albert Sans** → headings
- **Alumni Sans** → títulos de promos (peso 900)
- **Inter** → body
