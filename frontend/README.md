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

## Pendiente (próximas conversaciones)

- Integración de API de deportes en vivo (`view-deportes` sigue con placeholder de carga)
- Modelos de apuestas deportivas
- Conexión de pasarela de pago real en backend

## Tipografías

Cargadas desde Google Fonts:
- **Albert Sans** → headings
- **Alumni Sans** → títulos de promos (peso 900)
- **Inter** → body
