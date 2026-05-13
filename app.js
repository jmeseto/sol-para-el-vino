const DEFAULT_CENTER = [40.4168, -3.7038];
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OVERPASS_TIMEOUT_MS = 10000;

const state = {
  buildings: [],
  bars: [],
  roads: [],
  visibleBars: [],
  selectedBar: null,
  suppressHoverUntil: 0,
  suppressMoveStatusUntil: 0,
  isLoading: false,
  shadowPolygons: [],
  selectedPlace: null,
  suggestions: [],
  activeSuggestion: -1,
  suggestionTimer: null,
  nowTimer: null,
  layers: {
    roads: L.layerGroup(),
    buildings: L.layerGroup(),
    shadows: L.layerGroup(),
    bars: L.layerGroup(),
    selected: L.layerGroup(),
  },
};

const map = L.map("map", { attributionControl: false, zoomControl: false }).setView(DEFAULT_CENTER, 16);
L.control.zoom({ position: "bottomright" }).addTo(map);
map.createPane("barPane");
map.getPane("barPane").style.zIndex = 720;
map.createPane("selectedPane");
map.getPane("selectedPane").style.zIndex = 760;

state.layers.roads.addTo(map);
state.layers.shadows.addTo(map);
state.layers.buildings.addTo(map);
state.layers.bars.addTo(map);
state.layers.selected.addTo(map);
L.control.attribution({ prefix: "Leaflet" }).addAttribution("&copy; OpenStreetMap").addTo(map);

const barOverlay = document.createElement("div");
barOverlay.className = "bar-html-overlay";
document.querySelector("#map").appendChild(barOverlay);

const hoverCard = document.createElement("div");
hoverCard.className = "map-hover-card";
hoverCard.hidden = true;
document.querySelector("#map").appendChild(hoverCard);

const els = {
  searchForm: document.querySelector("#searchForm"),
  helpButton: document.querySelector("#helpButton"),
  helpPanel: document.querySelector("#helpPanel"),
  placeInput: document.querySelector("#placeInput"),
  suggestions: document.querySelector("#suggestions"),
  emptyState: document.querySelector("#emptyState"),
  dateInput: document.querySelector("#dateInput"),
  timeInput: document.querySelector("#timeInput"),
  nowInput: document.querySelector("#nowInput"),
  radiusInput: document.querySelector("#radiusInput"),
  floorHeightInput: document.querySelector("#floorHeightInput"),
  terraceDistanceInput: document.querySelector("#terraceDistanceInput"),
  useMissingHeightInput: document.querySelector("#useMissingHeightInput"),
  missingLevelsInput: document.querySelector("#missingLevelsInput"),
  loadButton: document.querySelector("#loadButton"),
  locateButton: document.querySelector("#locateButton"),
  status: document.querySelector("#status"),
  selectedInfo: document.querySelector("#selectedInfo"),
  barList: document.querySelector("#barList"),
  sunBadge: document.querySelector("#sunBadge"),
};

setInitialDateTime();
updateSunBadge();

els.searchForm.addEventListener("submit", handleSearch);
els.helpButton.addEventListener("click", toggleHelp);
els.placeInput.addEventListener("input", handleSuggestionInput);
els.placeInput.addEventListener("keydown", handleSuggestionKeys);
els.placeInput.addEventListener("focus", () => renderSuggestions());
els.loadButton.addEventListener("click", loadDataForView);
els.locateButton.addEventListener("click", locateUser);
els.dateInput.addEventListener("change", redrawWithCurrentData);
els.timeInput.addEventListener("change", redrawWithCurrentData);
els.nowInput.addEventListener("change", handleNowToggle);
els.floorHeightInput.addEventListener("change", redrawWithCurrentData);
els.terraceDistanceInput.addEventListener("change", redrawWithCurrentData);
els.useMissingHeightInput.addEventListener("change", handleMissingHeightToggle);
els.missingLevelsInput.addEventListener("change", redrawWithCurrentData);
document.addEventListener("click", (event) => {
  if (!els.searchForm.contains(event.target)) hideSuggestions();
});
map.on("moveend", () => {
  updateBarOverlayPositions();
  if (Date.now() > state.suppressMoveStatusUntil) {
    setStatus("Mapa movido. Carga para actualizar.");
  }
});
map.on("move", updateBarOverlayPositions);
map.on("zoom", updateBarOverlayPositions);
map.on("zoomend", updateBarOverlayPositions);
window.addEventListener("load", () => setTimeout(() => map.invalidateSize(), 100));
window.addEventListener("resize", () => {
  map.invalidateSize();
  updateBarOverlayPositions();
});

function toggleHelp() {
  const open = els.helpPanel.hidden;
  els.helpPanel.hidden = !open;
  els.helpButton.setAttribute("aria-expanded", String(open));
}

async function handleSearch(event) {
  event.preventDefault();
  const query = els.placeInput.value.trim();
  if (!query) return;

  if (state.selectedPlace && normalizeText(query) === normalizeText(state.selectedPlace.title)) {
    map.setView([state.selectedPlace.lat, state.selectedPlace.lng], isBarLike(state.selectedPlace) ? 18 : Math.max(map.getZoom(), 17));
    redrawWithCurrentData();
    await loadDataForView({ center: state.selectedPlace, radius: 350, fromSearch: true });
    return;
  }

  if (state.suggestions.length) {
    const suggestion = state.suggestions[Math.max(0, state.activeSuggestion)];
    selectSuggestion(suggestion);
    await loadDataForView({ center: suggestion, radius: 350, fromSearch: true });
    return;
  }

  if (state.activeSuggestion >= 0 && state.suggestions[state.activeSuggestion]) {
    selectSuggestion(state.suggestions[state.activeSuggestion]);
    return;
  }

  const localBar = findLoadedBar(query);
  if (localBar) {
    selectLoadedBar(localBar);
    return;
  }

  setBusy(true, "Buscando lugar o bar...");
  try {
    const places = await searchPlaces(query, 1);
    const place = places[0];
    if (!place) {
      setStatus("No he encontrado ese sitio. Prueba con nombre + pueblo, por ejemplo \"Bar X Laredo\".");
      return;
    }
    selectSuggestion(place);
    await loadDataForView({ center: place, radius: 350, fromSearch: true });
  } catch (error) {
    setStatus(`Busqueda fallida: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

function handleSuggestionInput() {
  clearTimeout(state.suggestionTimer);
  const query = els.placeInput.value.trim();
  state.activeSuggestion = -1;

  if (query.length < 3) {
    state.suggestions = [];
    hideSuggestions();
    return;
  }

  state.suggestionTimer = setTimeout(async () => {
    try {
      const localPlaces = searchLoadedBars(query, 4);
      const places = await searchPlaces(query, Math.max(2, 6 - localPlaces.length));
      state.suggestions = [...localPlaces, ...places].slice(0, 6);
      renderSuggestions();
    } catch {
      state.suggestions = [];
      hideSuggestions();
    }
  }, 280);
}

function handleSuggestionKeys(event) {
  if (!state.suggestions.length) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    state.activeSuggestion = Math.min(state.activeSuggestion + 1, state.suggestions.length - 1);
    renderSuggestions();
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    state.activeSuggestion = Math.max(state.activeSuggestion - 1, 0);
    renderSuggestions();
  }

  if (event.key === "Escape") {
    hideSuggestions();
  }
}

async function searchPlaces(query, limit) {
  const params = new URLSearchParams({
    format: "jsonv2",
    addressdetails: "1",
    extratags: "1",
    limit: String(limit),
    q: query,
  });
  const bounds = map.getBounds();
  if (bounds.isValid()) {
    params.set("viewbox", [
      bounds.getWest(),
      bounds.getNorth(),
      bounds.getEast(),
      bounds.getSouth(),
    ].join(","));
  }
  const response = await fetch(`${NOMINATIM_URL}?${params}`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("No se pudo buscar en OpenStreetMap");
  return (await response.json()).map(normalizePlace);
}

function normalizePlace(place) {
  const address = place.address || {};
  const title = place.name || address.amenity || address.road || address.town || address.city || address.village || place.display_name;
  const town = address.city || address.town || address.village || address.municipality || address.county || "";
  const area = [town, address.state || address.province, address.country].filter(Boolean).join(", ");
  return {
    lat: Number(place.lat),
    lng: Number(place.lon),
    title,
    meta: area || place.display_name,
    displayName: place.display_name,
    type: place.type || place.class || "lugar",
  };
}

function renderSuggestions() {
  if (!state.suggestions.length || document.activeElement !== els.placeInput) {
    hideSuggestions();
    return;
  }

  els.suggestions.innerHTML = "";
  state.suggestions.forEach((place, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `suggestion${index === state.activeSuggestion ? " active" : ""}`;
    button.setAttribute("role", "option");
    button.innerHTML = `
      <span class="suggestion-title">${escapeHtml(place.title)}</span>
      <span class="suggestion-meta">${escapeHtml(place.meta)}</span>
    `;
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => selectSuggestion(place));
    els.suggestions.appendChild(button);
  });
  els.suggestions.classList.add("open");
}

function hideSuggestions() {
  els.suggestions.classList.remove("open");
  els.suggestions.innerHTML = "";
}

function selectSuggestion(place) {
  els.placeInput.value = place.title;
  state.selectedPlace = place;
  hideSuggestions();
  state.suppressMoveStatusUntil = Date.now() + 1000;
  map.setView([place.lat, place.lng], isBarLike(place) ? 18 : 17);
  showSearchTarget(place);
  setStatus(isBarLike(place)
    ? "Bar localizado. Pulsa \"Cargar bares y sombras\" para analizar la zona."
    : "Zona localizada. Pulsa \"Cargar bares y sombras\" para ver bares cercanos.");
}

function showSearchTarget(place) {
  state.layers.selected.clearLayers();
  els.emptyState.classList.add("hidden");
  const marker = L.circleMarker([place.lat, place.lng], {
    radius: 12,
    color: "#1d1606",
    weight: 3,
    fillColor: "#f28a15",
    fillOpacity: 1,
    interactive: true,
    pane: "selectedPane",
  }).addTo(state.layers.selected);
  marker.bindPopup(`
    <div class="popup-title">${escapeHtml(place.title)}</div>
    <div class="popup-meta">${escapeHtml(place.meta || "Resultado de busqueda")}</div>
  `).openPopup();
}

function searchLoadedBars(query, limit) {
  const needle = normalizeText(query);
  if (!needle || !state.bars.length) return [];
  return state.bars
    .map((bar) => ({
      bar,
      name: normalizeText(bar.name),
      distance: distanceMeters([map.getCenter().lat, map.getCenter().lng], [bar.lat, bar.lng]),
    }))
    .filter((item) => item.name.includes(needle) || needle.includes(item.name))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map(({ bar }) => ({
      lat: bar.lat,
      lng: bar.lng,
      title: bar.name,
      meta: `${bar.kind} cargado en esta zona`,
      displayName: bar.name,
      type: bar.kind,
    }));
}

function isLoadedPlace(place) {
  return String(place.meta || "").includes("cargado en esta zona");
}

function selectLoadedBar(bar) {
  state.selectedPlace = {
    lat: bar.lat,
    lng: bar.lng,
    title: bar.name,
    meta: bar.kind,
    displayName: bar.name,
    type: bar.kind,
  };
  els.placeInput.value = bar.name;
  map.setView([bar.lat, bar.lng], Math.max(map.getZoom(), 18));
  redrawWithCurrentData();
  showBarDetails(classifyBarTerrace(bar, getSunPosition(selectedDate(), map.getCenter().lat, map.getCenter().lng).elevation > 0));
  setStatus(`${bar.name} seleccionado. Carga si has movido el mapa.`);
}

function findLoadedBar(query) {
  const needle = normalizeText(query);
  if (!needle || !state.bars.length) return null;
  const matches = state.bars
    .map((bar) => ({
      bar,
      name: normalizeText(bar.name),
      distance: distanceMeters([map.getCenter().lat, map.getCenter().lng], [bar.lat, bar.lng]),
    }))
    .filter((item) => item.name.includes(needle) || needle.includes(item.name));
  matches.sort((a, b) => a.distance - b.distance);
  return matches[0]?.bar || null;
}

function isBarLike(place) {
  return ["bar", "cafe", "pub", "restaurant", "biergarten"].includes(String(place.type).toLowerCase());
}

function locateUser() {
  if (!navigator.geolocation) {
    setStatus("Tu navegador no ofrece geolocalizacion.");
    return;
  }
  setBusy(true, "Localizando...");
  navigator.geolocation.getCurrentPosition(
    (position) => {
      map.setView([position.coords.latitude, position.coords.longitude], 17);
      setBusy(false);
      setStatus("Zona localizada. Pulsa \"Cargar bares y sombras\".");
    },
    () => {
      setBusy(false);
      setStatus("No se pudo obtener tu ubicacion.");
    },
    { enableHighAccuracy: true, timeout: 9000 }
  );
}

async function loadDataForView(options = {}) {
  if (state.isLoading) return;
  state.isLoading = true;
  if (els.nowInput.checked) setDateTimeToNow();
  setBusy(true, options.fromSearch ? "Zona encontrada. Cargando alrededores..." : "Descargando edificios y bares desde OpenStreetMap...");
  clearLayers();

  try {
    const radius = Number(options.radius || els.radiusInput.value);
    const center = options.center
      ? { lat: Number(options.center.lat), lng: Number(options.center.lng) }
      : map.getCenter();
    const bbox = bboxAround(center.lat, center.lng, radius);
    const query = overpassQuery(bbox);
    const data = await fetchOverpass(query);
    const parsed = parseOverpass(data);
    state.buildings = parsed.buildings;
    state.bars = parsed.bars;
    state.roads = parsed.roads;
    els.emptyState.classList.add("hidden");
    redrawWithCurrentData();
  } catch (error) {
    setStatus(`No se pudieron cargar datos: ${error.message}. Es el servicio gratuito de OpenStreetMap/Overpass, no tu busqueda. Prueba con 350 m o espera un minuto.`);
  } finally {
    state.isLoading = false;
    setBusy(false);
  }
}

async function fetchOverpass(query) {
  let lastError = null;
  for (let index = 0; index < OVERPASS_ENDPOINTS.length; index += 1) {
    const endpoint = OVERPASS_ENDPOINTS[index];
    const host = new URL(endpoint).host;
    try {
      setStatus(`Descargando edificios y bares... servidor ${index + 1}/${OVERPASS_ENDPOINTS.length}`);
      const response = await fetchWithTimeout(endpoint, {
        method: "POST",
        body: `data=${encodeURIComponent(query)}`,
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      }, OVERPASS_TIMEOUT_MS);
      if (!response.ok) throw new Error(`${host} respondio ${response.status}`);
      return response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Overpass no respondio");
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Overpass tarda demasiado");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function redrawWithCurrentData() {
  if (els.nowInput.checked) setDateTimeToNow();
  updateSunBadge();
  state.layers.shadows.clearLayers();
  state.layers.roads.clearLayers();
  state.layers.buildings.clearLayers();
  state.layers.bars.clearLayers();
  state.layers.selected.clearLayers();
  barOverlay.innerHTML = "";
  state.visibleBars = [];
  state.shadowPolygons = [];

  if (!state.buildings.length && !state.bars.length && !state.roads.length) return;

  const sun = getSunPosition(selectedDate(), map.getCenter().lat, map.getCenter().lng);
  const floorHeight = Number(els.floorHeightInput.value);
  const sunUp = sun.elevation > 0;

  for (const road of state.roads) {
    const isMajor = ["primary", "secondary", "tertiary", "trunk"].includes(road.kind);
    const isWalk = ["pedestrian", "footway", "path", "steps"].includes(road.kind);
    L.polyline(road.points.map(([lat, lng]) => [lat, lng]), {
      color: isMajor ? "#e6a67d" : isWalk ? "#d8d3c4" : "#ffffff",
      weight: isMajor ? 6 : isWalk ? 2 : 4,
      opacity: isMajor ? 0.92 : 0.86,
      lineCap: "round",
      lineJoin: "round",
      interactive: Boolean(road.name),
    })
      .bindTooltip(road.name || "", { sticky: true })
      .addTo(state.layers.roads);
  }

  for (const building of state.buildings) {
    const height = estimateHeight(building.tags, floorHeight);
    const latLngs = building.rings[0].map(([lat, lng]) => [lat, lng]);
    L.polygon(latLngs, {
      color: "#7a7166",
      weight: 1,
      fillColor: "#8b8173",
      fillOpacity: 0.34,
      interactive: false,
    }).addTo(state.layers.buildings);

    if (sunUp && height.meters > 0) {
      const shadows = shadowPolygonsForBuilding(building.rings[0], height.meters, sun, height.source);
      for (const shadow of shadows) {
        state.shadowPolygons.push(shadow);
        L.polygon(shadow.map(([lat, lng]) => [lat, lng]), {
          color: "#263d49",
          weight: 0,
          fillColor: "#435b68",
          fillOpacity: 0.28,
          interactive: false,
        }).addTo(state.layers.shadows);
      }
    }
  }

  const classifiedBars = state.bars.map((bar) => classifyBarTerrace(bar, sunUp));
  state.visibleBars = classifiedBars;

  renderBarOverlay(classifiedBars);
  renderBarList(classifiedBars);
  renderSelectedPlace(classifiedBars, sunUp);
  const taggedHeights = state.buildings.filter((building) => estimateHeight(building.tags, floorHeight).source !== "desconocida").length;
  const heightMode = els.useMissingHeightInput.checked ? `manual ${els.missingLevelsInput.value} pisos` : "solo datos OSM";
  const note = sunUp
    ? `${state.bars.length} sitios. ${taggedHeights}/${state.buildings.length} edificios con altura. ${heightMode}.`
    : "El sol esta bajo el horizonte para esa hora: no marco sol directo.";
  setStatus(note);
}

function renderBarOverlay(bars) {
  barOverlay.innerHTML = "";
  for (const bar of bars) {
    const label = sunLabel(bar);
    const color = !bar.sunUp ? "#555" : bar.shaded ? "#435b68" : "#da7d19";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `bar-html-label ${bar.shaded ? "is-shade" : "is-sun"}${isSelectedBar(bar) ? " is-selected" : ""}`;
    button.dataset.lat = String(bar.lat);
    button.dataset.lng = String(bar.lng);
    button.dataset.name = bar.name;
    button.dataset.label = `${bar.name}: ${label}`;
    button.style.setProperty("--pin-color", color);
    button.setAttribute("aria-label", `${bar.name}: ${label}`);
    button.addEventListener("mouseenter", () => showHoverCard(bar, label, button));
    button.addEventListener("mousemove", () => positionHoverCard(button));
    button.addEventListener("mouseleave", hideHoverCard);
    button.addEventListener("click", () => {
      showBarDetails(bar);
    });
    barOverlay.appendChild(button);
  }
  updateBarOverlayPositions();
}

function updateBarOverlayPositions() {
  if (!barOverlay) return;
  const bounds = map.getBounds();
  const panelRect = document.querySelector(".panel").getBoundingClientRect();
  const mapRect = document.querySelector("#map").getBoundingClientRect();
  const coveredRight = Math.max(0, panelRect.right - mapRect.left + 10);
  for (const el of barOverlay.querySelectorAll(".bar-html-label")) {
    const lat = Number(el.dataset.lat);
    const lng = Number(el.dataset.lng);
    const visible = bounds.contains([lat, lng]);
    const point = map.latLngToContainerPoint([lat, lng]);
    const underPanel = window.innerWidth > 720 && point.x < coveredRight;
    if (!visible || underPanel) {
      el.style.display = "none";
      continue;
    }
    el.style.display = "inline-flex";
    el.style.transform = `translate(${Math.round(point.x)}px, ${Math.round(point.y)}px) translate(-50%, -50%)`;
  }
}

function showHoverCard(bar, label, anchor) {
  if (Date.now() < state.suppressHoverUntil) return;
  hoverCard.innerHTML = `
    <strong>${escapeHtml(bar.name)}</strong>
    <span>${escapeHtml(label)}</span>
  `;
  hoverCard.hidden = false;
  hoverCard.style.display = "grid";
  positionHoverCard(anchor);
}

function positionHoverCard(anchor) {
  if (hoverCard.hidden) return;
  const mapRect = document.querySelector("#map").getBoundingClientRect();
  const rect = anchor.getBoundingClientRect();
  const x = rect.left - mapRect.left + rect.width + 10;
  const y = rect.top - mapRect.top + rect.height / 2;
  hoverCard.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translateY(-50%)`;
}

function hideHoverCard() {
  hoverCard.hidden = true;
  hoverCard.style.display = "none";
}

async function showBarDetails(bar) {
  state.layers.selected.clearLayers();
  state.suppressHoverUntil = Date.now() + 900;
  hideHoverCard();
  map.closePopup();
  state.selectedBar = bar;
  state.selectedPlace = {
    lat: bar.lat,
    lng: bar.lng,
    title: bar.name,
    meta: bar.kind,
    displayName: bar.name,
    type: bar.kind,
  };
  const target = bar.terracePoint || [bar.lat, bar.lng];
  if (!map.getBounds().pad(-0.15).contains(target)) {
    map.panTo(target);
  }
  const weather = await loadWeather(bar.lat, bar.lng).catch(() => null);
  const html = barDetailsHtml(bar, weather);
  els.selectedInfo.hidden = false;
  els.selectedInfo.innerHTML = html;
  L.popup({ autoPan: true })
    .setLatLng(target)
    .setContent(html)
    .openOn(map);
  renderBarOverlay(state.visibleBars);
  renderBarList(state.visibleBars);
  renderSelectedPlace(state.visibleBars, bar.sunUp);
}

function barDetailsHtml(bar, weather) {
  const label = sunLabel(bar);
  const terrace = bar.terracePoint ? "Punto terraza evaluado" : "Punto OSM del local";
  const address = bar.address || "Direccion no disponible";
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${bar.name} ${bar.lat},${bar.lng}`)}`;
  const weatherLine = weather
    ? `${Math.round(weather.temperature)} C, ${weather.description}. Lluvia ${weather.rainProbability}%, viento ${Math.round(weather.windSpeed)} km/h ${windDirectionLabel(weather.windDirection)}`
    : "Tiempo no disponible";
  return `
    <strong>${escapeHtml(bar.name)}</strong>
    <span>${escapeHtml(bar.kind)} - ${escapeHtml(label)}</span>
    <span>${escapeHtml(address)}</span>
    <span>${terrace}</span>
    <span>${escapeHtml(weatherLine)}</span>
    <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer">Abrir en Google Maps</a>
  `;
}

async function loadWeather(lat, lng) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    current: "temperature_2m,apparent_temperature,precipitation,cloud_cover,weather_code,wind_speed_10m,wind_direction_10m",
    hourly: "precipitation_probability",
    forecast_days: "1",
    timezone: "auto",
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!response.ok) throw new Error("Tiempo no disponible");
  const data = await response.json();
  const current = data.current || {};
  const rainProbability = nearestHourlyValue(data.hourly?.time, data.hourly?.precipitation_probability, current.time);
  return {
    temperature: Number(current.temperature_2m),
    apparent: Number(current.apparent_temperature),
    precipitation: Number(current.precipitation),
    cloud: Number(current.cloud_cover),
    rainProbability: Number.isFinite(rainProbability) ? rainProbability : 0,
    windSpeed: Number(current.wind_speed_10m || 0),
    windDirection: Number(current.wind_direction_10m || 0),
    code: Number(current.weather_code),
    description: weatherCodeLabel(Number(current.weather_code)),
  };
}

function nearestHourlyValue(times = [], values = [], currentTime) {
  if (!times.length || !values.length || !currentTime) return null;
  const target = new Date(currentTime).getTime();
  let bestIndex = 0;
  let bestDistance = Infinity;
  times.forEach((time, index) => {
    const distance = Math.abs(new Date(time).getTime() - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return Number(values[bestIndex]);
}

function windDirectionLabel(degrees) {
  const directions = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
  return directions[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
}

function weatherCodeLabel(code) {
  if ([0].includes(code)) return "despejado";
  if ([1, 2].includes(code)) return "poco nuboso";
  if ([3].includes(code)) return "cubierto";
  if ([45, 48].includes(code)) return "niebla";
  if ([51, 53, 55, 56, 57].includes(code)) return "llovizna";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "lluvia";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "nieve";
  if ([95, 96, 99].includes(code)) return "tormenta";
  return "tiempo variable";
}

function shortName(name) {
  const clean = String(name).replace(/\s+/g, " ").trim();
  return clean.length > 18 ? `${clean.slice(0, 17)}...` : clean;
}

function classifyBarTerrace(bar, sunUp) {
  const candidates = terraceCandidatesForBar(bar)
    .map((point) => ({
      point,
      inBuilding: pointInAnyBuilding(point),
      roadDistance: distanceToNearestRoad(point),
      shaded: sunUp && isPointShaded(point, 2),
      distance: distanceMeters([bar.lat, bar.lng], point),
    }))
    .filter((candidate) => !candidate.inBuilding);

  const nearRoad = candidates.filter((candidate) => candidate.roadDistance <= 16);
  const pool = nearRoad.length ? nearRoad : candidates;
  const sorted = [...pool].sort((a, b) => Number(a.shaded) - Number(b.shaded) || a.roadDistance - b.roadDistance || a.distance - b.distance);
  const chosen = sorted[0];

  if (!chosen) {
    return {
      ...bar,
      sunUp,
      shaded: sunUp && isPointShaded([bar.lat, bar.lng], 2),
      terracePoint: null,
      terraceMode: false,
    };
  }

  return {
    ...bar,
    sunUp,
    shaded: chosen.shaded,
    terracePoint: chosen.point,
    terraceMode: true,
    terraceRoadDistance: chosen.roadDistance,
  };
}

function terraceCandidatesForBar(bar) {
  const facade = nearestBuildingEdge([bar.lat, bar.lng]);
  if (!facade || facade.distance > 35) return radialTerraceCandidates(bar);

  const terraceDistance = Number(els.terraceDistanceInput.value);
  const alongOffsets = [-14, -8, -4, 0, 4, 8, 14];
  const sideOffsets = [terraceDistance, terraceDistance + 3];
  const candidates = [];

  for (const along of alongOffsets) {
    const base = offsetXY(facade.closest, facade.unit[0] * along, facade.unit[1] * along);
    for (const side of sideOffsets) {
      candidates.push(offsetXY(base, facade.normal[0] * side, facade.normal[1] * side));
      candidates.push(offsetXY(base, -facade.normal[0] * side, -facade.normal[1] * side));
    }
  }

  return candidates.map((point) => [point.lat, point.lng]);
}

function radialTerraceCandidates(bar) {
  const base = Number(els.terraceDistanceInput.value);
  const distances = [base, base + 4, base + 8];
  const candidates = [];
  for (const distance of distances) {
    for (let angle = 0; angle < 360; angle += 22.5) {
      candidates.push(offsetLatLng(bar.lat, bar.lng, distance, angle));
    }
  }
  return candidates;
}

function nearestBuildingEdge(point) {
  let best = null;
  for (const building of state.buildings) {
    for (const ring of building.rings) {
      const openRing = ring.length > 1 && samePoint(ring[0], ring[ring.length - 1]) ? ring.slice(0, -1) : ring;
      for (let i = 0; i < openRing.length; i += 1) {
        const a = openRing[i];
        const b = openRing[(i + 1) % openRing.length];
        const candidate = closestPointOnSegment(point, a, b);
        if (!best || candidate.distance < best.distance) best = candidate;
      }
    }
  }
  return best;
}

function closestPointOnSegment(point, start, end) {
  const lat0 = point[0] * Math.PI / 180;
  const toXY = ([lat, lng]) => ({
    x: lng * 111320 * Math.cos(lat0),
    y: lat * 111320,
    lat,
    lng,
  });
  const p = toXY(point);
  const a = toXY(start);
  const b = toXY(end);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq)) : 0;
  const x = a.x + t * dx;
  const y = a.y + t * dy;
  const length = Math.sqrt(lengthSq) || 1;
  return {
    closest: {
      lat: y / 111320,
      lng: x / (111320 * Math.cos(lat0)),
    },
    distance: Math.hypot(p.x - x, p.y - y),
    unit: [dx / length, dy / length],
    normal: [-dy / length, dx / length],
  };
}

function offsetXY(point, eastMeters, northMeters) {
  const lat = point.lat + northMeters / 111320;
  const lng = point.lng + eastMeters / (111320 * Math.cos(point.lat * Math.PI / 180));
  return { lat, lng };
}

function sunLabel(bar) {
  if (!bar.sunUp) return "sin sol directo";
  const place = bar.terraceMode ? "terraza" : "punto";
  return bar.shaded ? `${place}: sombra probable` : `${place}: sol probable`;
}

function isPointShaded(point, bufferMeters) {
  return state.shadowPolygons.some((polygon) => pointInPolygonBuffered(point, polygon, bufferMeters));
}

function pointInAnyBuilding(point) {
  return state.buildings.some((building) => building.rings.some((ring) => pointInPolygon(point, ring)));
}

function distanceToNearestRoad(point) {
  let best = Infinity;
  for (const road of state.roads) {
    for (let i = 1; i < road.points.length; i += 1) {
      best = Math.min(best, distancePointToSegmentMeters(point, road.points[i - 1], road.points[i]));
      if (best <= 2) return best;
    }
  }
  return best;
}

function renderSelectedPlace(classifiedBars, sunUp) {
  if (!state.selectedPlace) return;
  const selected = nearestBarToSelected(classifiedBars) || classifyBarTerrace({
    name: state.selectedPlace.title,
    lat: state.selectedPlace.lat,
    lng: state.selectedPlace.lng,
    kind: state.selectedPlace.type,
  }, sunUp);
  const label = sunLabel(selected);
  const color = !selected.sunUp ? "#555" : selected.shaded ? "#263d49" : "#f28a15";

  L.circleMarker([selected.lat, selected.lng], {
    radius: 13,
    color: "#fffaf0",
    weight: 4,
    fillColor: color,
    fillOpacity: 1,
    interactive: true,
    pane: "selectedPane",
  })
    .addTo(state.layers.selected);

  if (selected.terracePoint) {
    L.circleMarker(selected.terracePoint, {
      radius: 7,
      color: "#1d1606",
      weight: 2,
      fillColor: color,
      fillOpacity: 1,
      interactive: true,
      pane: "selectedPane",
    })
      .addTo(state.layers.selected);
    L.polyline([[selected.lat, selected.lng], selected.terracePoint], {
      color,
      dashArray: "4 5",
      weight: 2,
      opacity: 0.9,
    }).addTo(state.layers.selected);
  }
}

function nearestBarToSelected(bars) {
  if (!state.selectedPlace || !bars.length) return null;
  const normalizedSearch = normalizeText(state.selectedPlace.title);
  const candidates = bars
    .map((bar) => ({
      ...bar,
      distance: distanceMeters([state.selectedPlace.lat, state.selectedPlace.lng], [bar.lat, bar.lng]),
      nameMatch: normalizeText(bar.name).includes(normalizedSearch) || normalizedSearch.includes(normalizeText(bar.name)),
    }))
    .filter((bar) => bar.distance <= 80);

  if (!candidates.length) return null;
  candidates.sort((a, b) => Number(b.nameMatch) - Number(a.nameMatch) || a.distance - b.distance);
  return candidates[0];
}

function renderBarList(bars) {
  els.barList.innerHTML = "";
  if (!bars.length) {
    els.barList.innerHTML = `<li class="bar-card"><span></span><div><div class="bar-name">No hay bares en esta descarga</div><div class="bar-meta">Prueba con mas radio o mueve el mapa.</div></div></li>`;
    return;
  }

  const visibleBars = prioritizeSelectedBars(bars).slice(0, 12);
  for (const bar of visibleBars) {
    const label = sunLabel(bar);
    const li = document.createElement("li");
    li.className = `bar-card${isCurrentBar(bar) ? " selected-card" : ""}`;
    li.innerHTML = `
      <span class="bar-dot ${bar.shaded ? "shade" : "sun"}"></span>
      <div>
        <div class="bar-name">${escapeHtml(bar.name)}</div>
        <div class="bar-meta">${label} - ${escapeHtml(bar.kind)}</div>
      </div>
    `;
    li.addEventListener("click", () => {
      state.suppressHoverUntil = Date.now() + 900;
      hideHoverCard();
      map.setView(bar.terracePoint || [bar.lat, bar.lng], Math.max(map.getZoom(), 18));
      showBarDetails(bar);
    });
    els.barList.appendChild(li);
  }
}

function prioritizeSelectedBars(bars) {
  if (!state.selectedBar && !state.selectedPlace) return bars;
  return [...bars].sort((a, b) => Number(isCurrentBar(b) || isSelectedBar(b)) - Number(isCurrentBar(a) || isSelectedBar(a)));
}

function isCurrentBar(bar) {
  if (!state.selectedBar) return false;
  return normalizeText(state.selectedBar.name) === normalizeText(bar.name) &&
    distanceMeters([state.selectedBar.lat, state.selectedBar.lng], [bar.lat, bar.lng]) < 20;
}

function isSelectedBar(bar) {
  if (!state.selectedPlace) return false;
  const distance = distanceMeters([state.selectedPlace.lat, state.selectedPlace.lng], [bar.lat, bar.lng]);
  if (distance > 80) return false;
  const searchName = normalizeText(state.selectedPlace.title);
  const barName = normalizeText(bar.name);
  return barName.includes(searchName) || searchName.includes(barName) || distance < 15;
}

function parseOverpass(data) {
  const nodes = new Map();
  const buildings = [];
  const bars = [];
  const roads = [];

  for (const el of data.elements) {
    if (el.type === "node") nodes.set(el.id, [el.lat, el.lon]);
  }

  for (const el of data.elements) {
    const tags = el.tags || {};
    const amenity = tags.amenity;
    if (["bar", "cafe", "pub", "restaurant"].includes(amenity)) {
      const position = elementCenter(el, nodes);
      if (position) {
        bars.push({
          id: `${el.type}/${el.id}`,
          lat: position[0],
          lng: position[1],
          name: tags.name || prettyAmenity(amenity),
          kind: prettyAmenity(amenity),
          address: formatAddress(tags),
        });
      }
    }

    if (tags.building && el.type === "way" && Array.isArray(el.nodes)) {
      const ring = el.nodes.map((id) => nodes.get(id)).filter(Boolean);
      if (ring.length >= 3) buildings.push({ id: el.id, tags, rings: [closeRing(ring)] });
    }

    if (tags.highway && el.type === "way" && Array.isArray(el.nodes)) {
      const points = el.nodes.map((id) => nodes.get(id)).filter(Boolean);
      if (points.length >= 2) {
        roads.push({
          id: el.id,
          kind: tags.highway,
          name: tags.name || "",
          points,
        });
      }
    }
  }

  return { buildings, bars: uniqueNearbyBars(uniqueById(bars)), roads };
}

function overpassQuery(bbox) {
  const box = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  return `
    [out:json][timeout:12];
    (
      way["building"](${box});
      way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|living_street|pedestrian|service)$"](${box});
      node["amenity"~"^(bar|cafe|pub|restaurant)$"](${box});
      way["amenity"~"^(bar|cafe|pub|restaurant)$"](${box});
    );
    out body;
    >;
    out skel qt;
  `;
}

function selectedDate() {
  if (els.nowInput.checked) return new Date();
  const [year, month, day] = els.dateInput.value.split("-").map(Number);
  const [hour, minute] = els.timeInput.value.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute || 0, 0);
}

function handleNowToggle() {
  els.dateInput.disabled = els.nowInput.checked;
  els.timeInput.disabled = els.nowInput.checked;
  if (els.nowInput.checked) {
    setDateTimeToNow();
    state.nowTimer = window.setInterval(() => {
      setDateTimeToNow();
      redrawWithCurrentData();
    }, 60000);
  } else {
    window.clearInterval(state.nowTimer);
    state.nowTimer = null;
  }
  redrawWithCurrentData();
}

function handleMissingHeightToggle() {
  els.missingLevelsInput.disabled = !els.useMissingHeightInput.checked;
  redrawWithCurrentData();
}

function setInitialDateTime() {
  const now = new Date();
  now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
  els.dateInput.value = formatDate(now);
  els.timeInput.value = formatTime(now);
}

function setDateTimeToNow() {
  const now = new Date();
  els.dateInput.value = formatDate(now);
  els.timeInput.value = formatTime(now);
}

function updateSunBadge() {
  const sun = getSunPosition(selectedDate(), map.getCenter().lat, map.getCenter().lng);
  if (sun.elevation <= 0) {
    els.sunBadge.textContent = "sin sol";
    return;
  }
  els.sunBadge.textContent = `${Math.round(sun.elevation)} deg alt`;
}

function getSunPosition(date, latitude, longitude) {
  const rad = Math.PI / 180;
  const day = dayOfYear(date);
  const hour = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  const gamma = (2 * Math.PI / 365) * (day - 1 + (hour - 12) / 24);
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const offset = -date.getTimezoneOffset();
  const trueSolarTime = (hour * 60 + eqTime + 4 * longitude - offset + 1440) % 1440;
  const hourAngle = (trueSolarTime / 4 - 180) * rad;
  const latRad = latitude * rad;
  const zenith = Math.acos(
    Math.sin(latRad) * Math.sin(decl) + Math.cos(latRad) * Math.cos(decl) * Math.cos(hourAngle)
  );
  const elevation = 90 - zenith / rad;
  const azimuth = ((Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(latRad) - Math.tan(decl) * Math.cos(latRad)) / rad) + 180) % 360;
  return { elevation, azimuth };
}

function shadowPolygonsForBuilding(ring, height, sun, source) {
  const elevationRad = Math.max(0.5, sun.elevation) * Math.PI / 180;
  const rawLength = height / Math.tan(elevationRad);
  const length = Math.min(450, rawLength);
  const shadowAz = (sun.azimuth + 180) % 360;
  const openRing = ring.length > 1 && samePoint(ring[0], ring[ring.length - 1]) ? ring.slice(0, -1) : ring;
  const shadows = [];

  for (let i = 0; i < openRing.length; i += 1) {
    const a = openRing[i];
    const b = openRing[(i + 1) % openRing.length];
    const a2 = offsetLatLng(a[0], a[1], length, shadowAz);
    const b2 = offsetLatLng(b[0], b[1], length, shadowAz);
    shadows.push([a, b, b2, a2]);
  }

  return shadows;
}

function samePoint(a, b) {
  return Math.abs(a[0] - b[0]) < 0.0000001 && Math.abs(a[1] - b[1]) < 0.0000001;
}

function estimateHeight(tags, floorHeight) {
  const height = parseMeters(tags.height || tags["building:height"]);
  const minHeight = parseMeters(tags.min_height) || 0;
  if (height) return { meters: Math.max(0, height - minHeight), source: "height" };

  const levels = Number.parseFloat(tags["building:levels"] || tags.levels || "");
  const roof = parseMeters(tags["roof:height"]) || 0;
  if (Number.isFinite(levels) && levels > 0) {
    return { meters: Math.max(0, levels * floorHeight + roof - minHeight), source: "plantas" };
  }

  if (els.useMissingHeightInput.checked) {
    const missingLevels = Number(els.missingLevelsInput.value);
    return { meters: Math.max(0, missingLevels * floorHeight - minHeight), source: "manual" };
  }

  return { meters: 0, source: "desconocida" };
}

function parseMeters(value) {
  if (!value) return null;
  const normalized = String(value).replace(",", ".").match(/[\d.]+/);
  const meters = normalized ? Number.parseFloat(normalized[0]) : NaN;
  return Number.isFinite(meters) && meters > 0 ? meters : null;
}

function pointInPolygon(point, polygon) {
  const [lat, lng] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [latI, lngI] = polygon[i];
    const [latJ, lngJ] = polygon[j];
    const intersects = lngI > lng !== lngJ > lng && lat < ((latJ - latI) * (lng - lngI)) / (lngJ - lngI) + latI;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygonBuffered(point, polygon, bufferMeters) {
  if (pointInPolygon(point, polygon)) return true;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    if (distancePointToSegmentMeters(point, polygon[j], polygon[i]) <= bufferMeters) return true;
  }
  return false;
}

function distancePointToSegmentMeters(point, start, end) {
  const lat0 = point[0] * Math.PI / 180;
  const toXY = ([lat, lng]) => [
    lng * 111320 * Math.cos(lat0),
    lat * 111320,
  ];
  const [px, py] = toXY(point);
  const [ax, ay] = toXY(start);
  const [bx, by] = toXY(end);
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (!lengthSq) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distanceMeters(a, b) {
  const lat = ((a[0] + b[0]) / 2) * Math.PI / 180;
  const dx = (b[1] - a[1]) * 111320 * Math.cos(lat);
  const dy = (b[0] - a[0]) * 111320;
  return Math.hypot(dx, dy);
}

function normalizeText(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function convexHull(points) {
  const unique = [...new Map(points.map((point) => [`${point[0].toFixed(8)},${point[1].toFixed(8)}`, point])).values()];
  if (unique.length <= 3) return unique;
  const sorted = unique.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const cross = (o, a, b) => (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1]);
  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (const point of sorted.slice().reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function offsetLatLng(lat, lng, meters, azimuthDegrees) {
  const rad = azimuthDegrees * Math.PI / 180;
  const north = meters * Math.cos(rad);
  const east = meters * Math.sin(rad);
  return [
    lat + north / 111320,
    lng + east / (111320 * Math.cos(lat * Math.PI / 180)),
  ];
}

function bboxAround(lat, lng, radiusMeters) {
  const dLat = radiusMeters / 111320;
  const dLng = radiusMeters / (111320 * Math.cos(lat * Math.PI / 180));
  return { south: lat - dLat, west: lng - dLng, north: lat + dLat, east: lng + dLng };
}

function elementCenter(el, nodes) {
  if (Number.isFinite(el.lat) && Number.isFinite(el.lon)) return [el.lat, el.lon];
  if (Array.isArray(el.nodes)) {
    const ring = el.nodes.map((id) => nodes.get(id)).filter(Boolean);
    if (ring.length) {
      const sum = ring.reduce((acc, point) => [acc[0] + point[0], acc[1] + point[1]], [0, 0]);
      return [sum[0] / ring.length, sum[1] / ring.length];
    }
  }
  return null;
}

function closeRing(ring) {
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
}

function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / 86400000);
}

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatTime(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function clearLayers() {
  state.layers.shadows.clearLayers();
  state.layers.roads.clearLayers();
  state.layers.buildings.clearLayers();
  state.layers.bars.clearLayers();
  state.layers.selected.clearLayers();
  barOverlay.innerHTML = "";
  state.visibleBars = [];
  state.barList = [];
}

function setBusy(isBusy, message) {
  els.loadButton.disabled = isBusy;
  els.loadButton.textContent = isBusy ? "Cargando..." : "Cargar bares y sombras";
  els.searchForm.querySelector("button").disabled = isBusy;
  if (message) setStatus(message);
}

function setStatus(message) {
  els.status.textContent = message;
}

function prettyAmenity(value) {
  return { bar: "bar", cafe: "cafeteria", pub: "pub", restaurant: "restaurante" }[value] || "local";
}

function formatAddress(tags) {
  const street = tags["addr:street"] || tags["addr:place"] || "";
  const number = tags["addr:housenumber"] || "";
  const city = tags["addr:city"] || tags["addr:town"] || tags["addr:village"] || "";
  return [street && `${street}${number ? `, ${number}` : ""}`, city].filter(Boolean).join(" - ");
}

function uniqueById(items) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function uniqueNearbyBars(items) {
  const result = [];
  for (const item of items) {
    const same = result.find((existing) =>
      normalizeText(existing.name) === normalizeText(item.name) &&
      distanceMeters([existing.lat, existing.lng], [item.lat, item.lng]) < 20
    );
    if (!same) result.push(item);
  }
  return result;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}
