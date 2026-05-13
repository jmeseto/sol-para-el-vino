# Sol para el vino

Prototipo gratuito para estimar si bares, cafeterias, pubs y restaurantes tienen sol o sombra a una fecha y hora concretas.

## Como funciona

- Usa OpenStreetMap como mapa base.
- Descarga edificios y locales cercanos desde Overpass API.
- Calcula la posicion solar en el navegador.
- Proyecta sombras geometricas desde los edificios.
- Estima alturas asi:
  1. `height` o `building:height` si existe.
  2. `building:levels * altura por planta` si existe.
- Si OpenStreetMap no tiene altura ni numero de plantas, el edificio se dibuja pero no proyecta sombra.
- Opcionalmente puedes activar pisos manuales para edificios sin altura.
- Los bares se clasifican usando puntos exteriores de terraza alrededor del local, no solo el punto interior de OpenStreetMap.
- El buscador acepta pueblos, barrios, direcciones y nombres de bar.
- La casilla `hora actual` actualiza fecha y hora automaticamente.

## Limitaciones

- No sabe si una mesa concreta esta dentro o fuera de una terraza.
- No incluye nubes, lluvia ni niebla.
- No modela arboles, toldos, soportales o relieves.
- La precision depende mucho de los datos de OpenStreetMap.

Abre `index.html` en el navegador para usarlo. Si prefieres servirlo en local:

```powershell
node dev-server.mjs
```

Despues abre `http://localhost:4173`.
