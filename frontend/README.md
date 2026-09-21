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
