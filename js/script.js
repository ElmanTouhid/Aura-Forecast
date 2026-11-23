/* =========================================================
   Aura Forecast — script.js
   Weather: Open-Meteo (no key) · Perfumes: Scento (no key)
   ========================================================= */

/* ---------- 1. Constants & State ---------- */
const SCENTO_BASE = "https://www.scento.com/api/perfume/v1";
const WEATHER_BASE = "https://api.open-meteo.com/v1/forecast";
const GEO_BASE = "https://geocoding-api.open-meteo.com/v1/search";
const FAV_KEY = "auraFavourites";

const DEFAULT_CITY = { name: "Chittagong", country: "Bangladesh", lat: 22.3569, lon: 91.7832 };

// Which scent to search for in each weather mood
const MOOD_QUERIES = {
  hot: "citrus",
  rainy: "green",
  cold: "vanilla",
  mild: "floral",
};

// How high each card rises, by distance from the hovered card (in px)
const WAVE_LIFT = [-34, -20, -9, -3];
const WAVE_SCALE = [1.06, 1.03, 1.01, 1];
const WAVE_TILT = [0, 2, 1, 0];

let exploreResults = [];   // perfumes from the last Explore search
let activeSeason = "all";  // current filter button
let favourites = loadFavourites();
const detailCache = {};    // slug -> full perfume details

/* ---------- 2. DOM Selectors ---------- */
const cityForm = document.querySelector("#city-form");
const cityInput = document.querySelector("#city-input");
const weatherStatus = document.querySelector("#weather-status");
const weatherLocation = document.querySelector("#weather-location");
const weatherTemp = document.querySelector("#weather-temp");
const weatherCondition = document.querySelector("#weather-condition");
const weatherHumidity = document.querySelector("#weather-humidity");
const weatherSeason = document.querySelector("#weather-season");
const weatherScene = document.querySelector("#weather-scene");

const auraStatus = document.querySelector("#aura-status");
const auraGrid = document.querySelector("#aura-grid");

const searchForm = document.querySelector("#search-form");
const searchInput = document.querySelector("#search-input");
const seasonFilters = document.querySelector("#season-filters");
const exploreStatus = document.querySelector("#explore-status");
const exploreGrid = document.querySelector("#explore-grid");

const favouritesStatus = document.querySelector("#favourites-status");
const favouritesGrid = document.querySelector("#favourites-grid");

const modal = document.querySelector("#modal");
const modalContent = document.querySelector(".modal__content");
const modalBody = document.querySelector("#modal-body");
const modalClose = document.querySelector("#modal-close");
const modalOverlay = document.querySelector("#modal-overlay");

/* ---------- 3. Status Helpers (loading / error / empty) ---------- */
function showLoading(el, message = "Loading...") {
  el.className = "status";
  el.innerHTML = `<div class="spinner"></div><p>${message}</p>`;
}

function showError(el, message) {
  el.className = "status error";
  el.innerHTML = `<p>⚠️ ${message}</p>`;
}

function showEmpty(el, message) {
  el.className = "status";
  el.innerHTML = `<p>${message}</p>`;
}

function clearStatus(el) {
  el.className = "status";
  el.innerHTML = "";
}

/* ---------- 4. Weather API ---------- */
async function getCityCoords(cityName) {
  const res = await fetch(`${GEO_BASE}?name=${encodeURIComponent(cityName)}&count=1`);
  if (!res.ok) throw new Error("Could not reach the location service.");
  const data = await res.json();
  if (!data.results || data.results.length === 0) return null;
  const place = data.results[0];
  return { name: place.name, country: place.country, lat: place.latitude, lon: place.longitude };
}

async function getWeather(lat, lon) {
  const url = `${WEATHER_BASE}?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Could not load the weather.");
  const data = await res.json();
  return data.current;
}

function describeWeatherCode(code) {
  if (code === 0) return "Clear sky";
  if ([1, 2, 3].includes(code)) return "Partly cloudy";
  if ([45, 48].includes(code)) return "Foggy";
  if (code >= 51 && code <= 67) return "Rainy";
  if (code >= 71 && code <= 77) return "Snowy";
  if (code >= 80 && code <= 82) return "Rain showers";
  if (code >= 95) return "Thunderstorm";
  return "Unknown";
}

// Picks which mini animation to show in the weather card
function getScene(code) {
  if (code === 0) return "clear";
  if ([1, 2, 3].includes(code)) return "cloudy";
  if ([45, 48].includes(code)) return "fog";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 95) return "storm";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rainy";
  return "cloudy";
}

/* ---------- 5. Season Logic ---------- */
function getMood(temp, code) {
  const isRainy = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
  if (isRainy) return { mood: "rainy", label: "Monsoon mood 🌧️", season: "spring" };
  if (temp >= 28) return { mood: "hot", label: "Summer mood ☀️", season: "summer" };
  if (temp <= 18) return { mood: "cold", label: "Winter mood ❄️", season: "winter" };

  const month = new Date().getMonth(); // 0 = Jan
  const season = month >= 8 && month <= 10 ? "autumn" : "spring";
  return { mood: "mild", label: season === "autumn" ? "Autumn mood 🍂" : "Spring mood 🌸", season };
}

function applyTheme(mood) {
  document.body.classList.remove("theme-hot", "theme-cold", "theme-rainy", "theme-mild");
  document.body.classList.add(`theme-${mood}`);
}

/* ---------- 6. Perfume API ---------- */
function slugFromPage(pageUrl) {
  return pageUrl ? pageUrl.split("/").filter(Boolean).pop() : "";
}

async function searchPerfumes(query) {
  const res = await fetch(`${SCENTO_BASE}/perfumes?q