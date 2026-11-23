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
  const res = await fetch(`${SCENTO_BASE}/perfumes?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error("Could not load perfumes.");
  const data = await res.json();
  const matches = data.detail?.matches || [];
  return matches.map((p) => ({
    slug: slugFromPage(p.page),
    name: p.name,
    house: p.house,
    family: p.family,
  }));
}

async function getPerfumeDetails(slug) {
  if (detailCache[slug]) return detailCache[slug];
  const res = await fetch(`${SCENTO_BASE}/perfumes/${slug}`);
  if (!res.ok) throw new Error("Could not load perfume details.");
  const data = await res.json();
  detailCache[slug] = data.detail;
  return data.detail;
}

// Adds each perfume's "wears.seasons" so we can filter by season
async function addSeasons(perfumes) {
  const results = await Promise.all(
    perfumes.map(async (p) => {
      try {
        const detail = await getPerfumeDetails(p.slug);
        return { ...p, seasons: detail?.wears?.seasons || [] };
      } catch {
        return { ...p, seasons: [] };
      }
    })
  );
  return results;
}

/* ---------- 7. Rendering ---------- */
function isFavourite(slug) {
  return favourites.some((f) => f.slug === slug);
}

function createCard(perfume) {
  const fav = isFavourite(perfume.slug);
  return `
    <article class="card" data-slug="${perfume.slug}">
      <button class="fav-btn ${fav ? "active" : ""}" data-slug="${perfume.slug}" aria-label="Toggle favourite">
        ${fav ? "♥" : "♡"}
      </button>
      <h3 class="card__name">${perfume.name}</h3>
      <p class="card__house">${perfume.house || "Unknown house"}</p>
      ${perfume.family ? `<span class="card__family">${perfume.family}</span>` : ""}
    </article>
  `;
}

function renderGrid(gridEl, perfumes) {
  gridEl.innerHTML = perfumes.map(createCard).join("");
}

function renderExplore() {
  const filtered =
    activeSeason === "all"
      ? exploreResults
      : exploreResults.filter((p) => p.seasons.includes(activeSeason));

  if (exploreResults.length > 0 && filtered.length === 0) {
    exploreGrid.innerHTML = "";
    showEmpty(exploreStatus, `No ${activeSeason} perfumes in these results. Try another filter.`);
    return;
  }
  clearStatus(exploreStatus);
  renderGrid(exploreGrid, filtered);
}

function renderFavourites() {
  if (favourites.length === 0) {
    favouritesGrid.innerHTML = "";
    showEmpty(favouritesStatus, "No favourites yet. Tap the ♡ on any perfume to save it.");
    return;
  }
  clearStatus(favouritesStatus);
  renderGrid(favouritesGrid, favourites);
}

async function openModal(slug) {
  modal.classList.remove("hidden");
  showLoading(modalBody, "Loading perfume...");
  try {
    const p = await getPerfumeDetails(slug);
    const notes = (p.notes || []).map((n) => `<span class="note">${n}</span>`).join("");
    const seasons = p.wears?.seasons?.join(", ") || "Any season";
    const hours = p.wears?.hours?.join(", ") || "Any time";

    modalBody.className = "";
    modalBody.innerHTML = `
      <h3>${p.name}</h3>
      <p class="card__house">${p.house || ""} · ${p.concentration || ""}</p>
      <div class="notes">${notes}</div>
      <p>${p.character || ""}</p>
      <p style="margin-top:1rem"><strong>Best seasons:</strong> ${seasons}</p>
      <p><strong>Best time:</strong> ${hours}</p>
    `;
  } catch (err) {
    showError(modalBody, err.message);
  }
}

function closeModal() {
  modal.classList.add("hidden");
  modalBody.innerHTML = "";
}

/* ---------- 8. Main Flows ---------- */
async function loadWeatherAndAura(city) {
  showLoading(weatherStatus, "Checking the sky...");
  try {
    const current = await getWeather(city.lat, city.lon);
    clearStatus(weatherStatus);

    const temp = Math.round(current.temperature_2m);
    const code = current.weather_code;
    const { mood, label, season } = getMood(temp, code);

    weatherLocation.textContent = `${city.name}, ${city.country}`;
    weatherTemp.textContent = `${temp}°C`;
    weatherCondition.textContent = describeWeatherCode(code);
    weatherHumidity.textContent = `Humidity: ${current.relative_humidity_2m}%`;
    weatherSeason.textContent = label;
    applyTheme(mood);

    loadAura(mood, season);
  } catch (err) {
    showError(weatherStatus, err.message);
  }
}

async function loadAura(mood, season) {
  auraGrid.innerHTML = "";
  showLoading(auraStatus, "Finding your aura...");
  try {
    const perfumes = await searchPerfumes(MOOD_QUERIES[mood]);
    const withSeasons = await addSeasons(perfumes);
    const matching = withSeasons.filter((p) => p.seasons.includes(season));

    // If nothing matches the season exactly, fall back to all results
    const picks = matching.length > 0 ? matching : withSeasons;

    if (picks.length === 0) {
      showEmpty(auraStatus, "No suggestions for this weather right now.");
      return;
    }
    clearStatus(auraStatus);
    renderGrid(auraGrid, picks.slice(0, 8));
  } catch (err) {
    showError(auraStatus, err.message);
  }
}

async function handleExploreSearch(query) {
  exploreGrid.innerHTML = "";
  showLoading(exploreStatus, `Searching for "${query}"...`);
  try {
    const perfumes = await searchPerfumes(query);
    if (perfumes.length === 0) {
      exploreResults = [];
      showEmpty(exploreStatus, `No perfumes found for "${query}".`);
      return;
    }
    exploreResults = await addSeasons(perfumes);
    renderExplore();
  } catch (err) {
    showError(exploreStatus, err.message);
  }
}

/* ---------- 9. Local Storage ---------- */
function loadFavourites() {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY)) || [];
  } catch {
    return [];
  }
}

function saveFavourites() {
  localStorage.setItem(FAV_KEY, JSON.stringify(favourites));
}

function toggleFavourite(slug) {
  if (isFavourite(slug)) {
    favourites = favourites.filter((f) => f.slug !== slug);
  } else {
    const all = [...exploreResults, ...Object.values(detailCache).map((d) => ({
      slug: slugFromPage(d?.page) || slug, name: d?.name, house: d?.house, family: d?.family,
    }))];
    const cardEl = document.querySelector(`.card[data-slug="${slug}"]`);
    const perfume = all.find((p) => p.slug === slug) || {
      slug,
      name: cardEl?.querySelector(".card__name")?.textContent,
      house: cardEl?.querySelector(".card__house")?.textContent,
      family: cardEl?.querySelector(".card__family")?.textContent,
    };
    favourites.push({ slug, name: perfume.name, house: perfume.house, family: perfume.family });
  }
  saveFavourites();
  refreshHearts(slug);
  renderFavourites();
}

function refreshHearts(slug) {
  const fav = isFavourite(slug);
  document.querySelectorAll(`.fav-btn[data-slug="${slug}"]`).forEach((btn) => {
    btn.classList.toggle("active", fav);
    btn.textContent = fav ? "♥" : "♡";
  });
}

/* ---------- 10. Event Listeners ---------- */
cityForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = cityInput.value.trim();
  if (!name) return;

  showLoading(weatherStatus, `Finding ${name}...`);
  try {
    const city = await getCityCoords(name);
    if (!city) {
      showEmpty(weatherStatus, `Couldn't find "${name}". Try another city.`);
      return;
    }
    cityInput.value = "";
    loadWeatherAndAura(city);
  } catch (err) {
    showError(weatherStatus, err.message);
  }
});

searchForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const query = searchInput.value.trim();
  if (!query) {
    showEmpty(exploreStatus, "Type a perfume, note or house to search.");
    return;
  }
  handleExploreSearch(query);
});

seasonFilters.addEventListener("click", (e) => {
  const btn = e.target.closest(".filter-btn");
  if (!btn) return;
  seasonFilters.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  activeSeason = btn.dataset.season;
  renderExplore();
});

// One listener for all cards (event delegation)
document.addEventListener("click", (e) => {
  const favBtn = e.target.closest(".fav-btn");
  if (favBtn) {
    e.stopPropagation();
    toggleFavourite(favBtn.dataset.slug);
    return;
  }
  const card = e.target.closest(".card");
  if (card) openModal(card.dataset.slug);
});

modalClose.addEventListener("click", closeModal);
modalOverlay.addEventListener("click", closeModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

/* ---------- 11. Start ---------- */
renderFavourites();
loadWeatherAndAura(DEFAULT_CITY);