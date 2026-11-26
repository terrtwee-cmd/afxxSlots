#!/usr/bin/env python3
"""
Quita el fondo blanco de las imagenes promocionales (PNGs con lienzo blanco).

El fondo se elimina SOLO si es blanco "conectado al borde" de la imagen,
de modo que el texto blanco que va dentro del diseno (p.ej. "HASTA 50%")
se conserva intacto.

Uso:
    python3 tools/remove-white-bg.py                 # procesa los banners promo
    python3 tools/remove-white-bg.py ruta/imagen.png  # procesa un archivo
    python3 tools/remove-white-bg.py --preview        # no guarda, solo informa

Requiere: Pillow, numpy
"""
import os
import sys
from collections import deque

from PIL import Image
import numpy as np

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(RAIZ, "frontend", "assets")

# Lienzo blanco horneado en el PNG (no se puede arreglar con CSS)
DEFAULT = [
    "promos/promo-invitar.png",
    "promos/promo-cofre.png",
    "promos/promo-elite.png",
    "promos/promo-segunda.png",
    "promos/promo-telegram.png",
    "promos/descarga-app.png",
    "promos/cofre-900.png",
    "promos/casino-superior.png",
    "promos/casino2superior.png",
    "promos/modal-vip.png",
    "promos/promo-elite-modal.png",
]

# Umbral: que tan blanco se considera "fondo" (0-255)
TOL = 26


def es_blanco(arr, tol=TOL):
    """Pixeles casi blancos y neutros (ignora dorados/cremas claros)."""
    r, g, b = arr[..., 0].astype(int), arr[..., 1].astype(int), arr[..., 2].astype(int)
    return (r >= 255 - tol) & (g >= 255 - tol) & (b >= 255 - tol) & ((np.abs(r - g) <= 12) & (np.abs(g - b) <= 12))


def quita_fondo_blanco(path, preview=False):
    im = Image.open(path)
    if im.mode != "RGBA":
        im = im.convert("RGBA")
    arr = np.array(im)
    h, w = arr.shape[:2]

    blanco = es_blanco(arr)
    # mascara de lo que NO se puede tocar (alpha ya existente)
    alpha = arr[..., 3]
    if (alpha < 250).any():
        # la imagen ya tiene transparencia: solo consideramos como fondo
        # el blanco que ademas es opaco
        blanco = blanco & (alpha >= 250)

    # flood fill desde el borde: BFS sobre pixeles blancos
    visitados = np.zeros((h, w), dtype=bool)
    cola = deque()
    for x in range(w):
        for y in (0, h - 1):
            if blanco[y, x] and not visitados[y, x]:
                visitados[y, x] = True
                cola.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if blanco[y, x] and not visitados[y, x]:
                visitados[y, x] = True
                cola.append((y, x))

    while cola:
        y, x = cola.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not visitados[ny, nx] and blanco[ny, nx]:
                visitados[ny, nx] = True
                cola.append((ny, nx))

    nuevo = arr.copy()
    nuevo[..., 3] = np.where(visitados, 0, arr[..., 3])

    # anti-borde: los pixeles pegados al recorte quedan con halo blanco.
    # Se "descolorean" hacia el color del vecino opaco mas cercano.
    halo = visitados.copy()
    for _ in range(2):
        halo = np.roll(halo, 1, 0) | np.roll(halo, -1, 0) | np.roll(halo, 1, 1) | np.roll(halo, -1, 1)
    halo &= ~visitados & (arr[..., 3] > 0)
    if halo.any():
        # para cada pixel con halo, se toma el promedio de sus vecinos no-halo
        datos = arr[..., :3].astype(np.float64)
        suma = np.zeros_like(datos)
        cuenta = np.zeros((h, w), dtype=np.float64)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            vecino = np.roll(np.roll(datos, dy, 0), dx, 1)
            ok = ~np.roll(np.roll(halo, dy, 0), dx, 1)
            suma += np.where(ok[..., None], vecino, 0)
            cuenta += ok
        avg = suma / np.maximum(cuenta, 1)[..., None]
        nuevo[..., :3] = np.where(halo[..., None], avg.astype(np.uint8), nuevo[..., :3])

    pct = visitados.sum() / (h * w) * 100
    if preview:
        return pct, None
    out = Image.fromarray(nuevo, "RGBA")
    out.save(path, optimize=True)
    return pct, out


def main():
    args = sys.argv[1:]
    preview = "--preview" in args
    archivos = [a for a in args if not a.startswith("--")]
    if not archivos:
        archivos = DEFAULT

    for rel in archivos:
        path = rel if os.path.isabs(rel) else os.path.join(ASSETS, rel)
        if not os.path.exists(path):
            print(f"  ! no existe: {rel}")
            continue
        pct, out = quita_fondo_blanco(path, preview=preview)
        estado = "analizado" if preview else "limpiado"
        print(f"  {rel:40s} fondo blanco eliminado: {pct:5.1f}%  [{estado}]")


if __name__ == "__main__":
    main()
