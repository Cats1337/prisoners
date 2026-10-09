const APP_ID = 238460;
const STORAGE_KEY = "bbt-prisoner-registry-v1";
const PAGE_SIZE = 36;
const API_BASE = "https://prisoner-check-api.cats1337.workers.dev";

let HEADS = [];

const CATEGORIES = [
    { id: "all", label: "All Prisoners", baseHead: "CatsRandom" },
    { id: "circle", label: "Circle Heads", baseHead: "Mom" },
    { id: "triangle", label: "Triangle Heads", baseHead: "Cousin Zack" },
    { id: "square", label: "Square Heads", baseHead: "George" },
    { id: "cylinder", label: "Cylinder Heads", baseHead: "Cousin Wesley" },
    { id: "star", label: "Star Heads", baseHead: "Pluto" },
];

const SHAPES = {
    circle: "shape-circle",
    triangle: "shape-triangle",
    square: "shape-square",
    cylinder: "shape-cylinder",
    star: "shape-star",
};

const $ = (id) => document.getElementById(id);

let selectedCategory = "all";
let visibleLimit = PAGE_SIZE;
let manualState = {};
let steamItems = [];
let steamConnected = false;
let toastTimer;
let syncing = false;
let initialized = false;

/*
 * DOM caches. Cards and nav buttons are built once and then only updated,
 * so images aren't torn down and reloaded on every render (that was the flash).
 */
const cardCache = new Map();
const navCache = new Map();

function getSteamIconUrl(icon) {
    return `https://community.akamai.steamstatic.com/economy/image/${icon}`;
}

async function loadHeads() {
    try {
        const response = await fetch("./heads.json");

        if (!response.ok) {
            throw new Error(`Could not load heads.json: HTTP ${response.status}`);
        }

        const heads = await response.json();

        if (!Array.isArray(heads)) {
            throw new Error("heads.json must contain a JSON array.");
        }

        HEADS = heads.map((head) => {
            const category = normalize(head.category);
            const name = String(head.name || "").trim();

            if (!name || !SHAPES[category]) {
                throw new Error(`Invalid head entry: ${JSON.stringify(head)}`);
            }

            return {
                ...head,
                id: head.id || `${category}-${normalize(name).replace(/\s+/g, "-")}`,
                name,
                category,
            };
        });

        init();
    } catch (error) {
        console.error("Failed to load prisoner heads:", error);
        showToast("Could not load prisoner heads. Check the console.");
    }
}

document.addEventListener("DOMContentLoaded", loadHeads);

/*
 * Manual overrides:
 * true  = explicitly owned
 * false = explicitly missing
 * absent = use Steam detection when available
 */
function loadProgress() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");

        manualState = saved.manualState || {};
        steamItems = Array.isArray(saved.steamItems) ? saved.steamItems : [];
        steamConnected = Boolean(saved.steamConnected);
    } catch {
        manualState = {};
        steamItems = [];
        steamConnected = false;
    }
}

function saveProgress() {
    try {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                version: 1,
                manualState,
                steamItems,
                steamConnected,
            }),
        );
    } catch {
        showToast("Could not save progress. Check browser storage settings.");
    }
}

function normalize(value) {
    return String(value || "")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function escapeHTML(value) {
    return String(value).replace(
        /[&<>"']/g,
        (character) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[character],
    );
}

function showToast(message) {
    const toast = $("toast");

    toast.textContent = message;
    toast.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 2600);
}

function isSteamOwned(head) {
    const aliases = [head.name, ...(head.steamAliases || [])].map(normalize).filter(Boolean);

    return aliases.some((alias) => steamItems.some((item) => normalize(item.market_hash_name || item.name) === alias));
}

function getStatus(head) {
    if (Object.hasOwn(manualState, head.id)) {
        return {
            owned: manualState[head.id],
            source: "manual",
        };
    }

    if (isSteamOwned(head)) {
        return {
            owned: true,
            source: "steam",
        };
    }

    return {
        owned: false,
        source: "none",
    };
}

/*
 * After a Steam recheck, any manual override for a head that Steam now
 * reports is redundant, so drop it and let Steam be the source of truth.
 */
function clearOverridesCoveredBySteam() {
    let cleared = 0;

    for (const head of HEADS) {
        if (Object.hasOwn(manualState, head.id) && isSteamOwned(head)) {
            delete manualState[head.id];
            cleared++;
        }
    }

    return cleared;
}

/* Sidebar */

function createNavButton(category) {
    let baseHead = category.baseHead === "CatsRandom"
        ? HEADS[Math.floor(Math.random() * HEADS.length)]
        : HEADS.find((head) => normalize(head.name) === normalize(category.baseHead));

    // If it's missing or uses EMPTY_PATH, choose a random valid head
    if (!baseHead || baseHead.icon_url === EMPTY_PATH) {
        const validHeads = HEADS.filter((head) => head.icon_url !== EMPTY_PATH);
        baseHead = validHeads[Math.floor(Math.random() * validHeads.length)];
    }

    const iconUrl = baseHead?.icon_url ? getSteamIconUrl(baseHead.icon_url) : "";

    const button = document.createElement("button");

    button.type = "button";
    button.className = "category-link";

    button.innerHTML = `
        <span class="category-icon">
            ${iconUrl ? `<img src="${escapeHTML(iconUrl)}" alt="" loading="lazy">` : ""}
        </span>
        <span class="nav-text">${escapeHTML(category.label)}</span>
        <span class="nav-count"></span>
    `;

    button.addEventListener("click", () => {
        selectedCategory = category.id;
        visibleLimit = PAGE_SIZE;

        renderNavigation();
        renderCollection();
    });

    return {
        button,
        count: button.querySelector(".nav-count"),
    };
}

function renderNavigation() {
    const nav = $("category-nav");

    for (const category of CATEGORIES) {
        let entry = navCache.get(category.id);

        if (!entry) {
            entry = createNavButton(category);
            navCache.set(category.id, entry);
            nav.appendChild(entry.button);
        }

        const count = category.id === "all" ? HEADS.length : HEADS.filter((head) => head.category === category.id).length;

        entry.button.classList.toggle("active", selectedCategory === category.id);

        entry.count.textContent = count;
    }
}

/* Dashboard statistics */
function renderStats() {
    const countableHeads = HEADS.filter(
        (head) => normalize(head.category) !== "star"
    );

    const starHeads = HEADS.filter(
        (head) => normalize(head.category) === "star"
    );

    const owned = countableHeads.filter(
        (head) => getStatus(head).owned
    ).length;

    const starOwned = starHeads.filter(
        (head) => getStatus(head).owned
    ).length;

    const manualCount = Object.keys(manualState).filter((id) =>
        HEADS.some((head) => head.id === id)
    ).length;

    // Include Star heads in Steam matches.
    const steamCount = HEADS.filter(isSteamOwned).length;

    const percentage = countableHeads.length
        ? Math.floor((owned * 100) / countableHeads.length)
        : 0;

    const starPercentage = starHeads.length
        ? Math.floor((starOwned * 100) / starHeads.length)
        : 0;

    // Main collection
    $("percent").textContent = percentage;
    $("overall-bar").style.width = `${percentage}%`;
    $("owned-count").textContent = owned;
    $("total-count").textContent = countableHeads.length;

    // Star collection
    $("star-percent").textContent = starPercentage;
    $("star-bar").style.width = `${starPercentage}%`;
    $("star-count").textContent = starOwned;
    $("star-total").textContent = starHeads.length;

    // Steam matches and manual overrides
    $("manual-count").textContent = manualCount;
    $("steam-count").textContent = steamCount;

    $("steam-note").textContent = steamConnected
        ? "Inventory loaded from Steam."
        : "Inventory couldn't be loaded; check Steam ID or URL and try again.";
}

/* Prisoner cards */

function buildCard(head) {
    const card = document.createElement("article");

    card.className = "head-card";
    card.tabIndex = 0; // lets keyboard and touch users open the description

    const shape = SHAPES[head.category] || "shape-square";

    card.innerHTML = `
        <div class="head-category">
            ${escapeHTML(getCategoryLabel(head.category))}
        </div>

        <div class="head-thumb">
            <span class="head-number"></span>

            <span class="ownership-mark" hidden>✓</span>

            ${
                head.icon_url
                    ? `<img
                    class="head-image"
                    src="${escapeHTML(getSteamIconUrl(head.icon_url))}"
                    alt="${escapeHTML(head.name)}"
                    loading="lazy"
                >`
                    : `<div class="mini-head ${shape}">
                    <span class="mini-eyes"><i></i><i></i></span>
                    <span class="mini-mouth"></span>
                </div>`
            }
        </div>

        <div class="head-name" title="${escapeHTML(head.name)}">
            ${escapeHTML(head.name)}
        </div>

        <div class="card-footer">
            <span class="source-tag"></span>

            <button class="toggle-btn" type="button"></button>
        </div>

        ${
            head.description
                ? `<div class="head-tooltip" role="tooltip">
                <strong>${escapeHTML(head.name)}</strong>
                <span>${escapeHTML(head.description)}</span>
            </div>`
                : ""
        }
    `;

    const entry = {
        card,
        number: card.querySelector(".head-number"),
        mark: card.querySelector(".ownership-mark"),
        tag: card.querySelector(".source-tag"),
        button: card.querySelector(".toggle-btn"),
    };

    entry.button.addEventListener("click", () => {
        /*
         * Toggle based on the state shown right now. This creates an explicit
         * manual override, including when Steam detected the item. The status
         * is read at click time because the card is reused between renders.
         */
        const status = getStatus(head);

        manualState[head.id] = !status.owned;

        saveProgress();
        renderAll();

        showToast(manualState[head.id] ? `${head.name} marked owned` : `${head.name} marked missing`);
    });

    return entry;
}

function updateCard(entry, head, index) {
    const status = getStatus(head);

    let sourceLabel = "NOT CHECKED";
    let sourceClass = "";

    if (status.source === "steam") {
        sourceLabel = "STEAM DETECTED";
        sourceClass = "detected";
    } else if (status.source === "manual") {
        sourceLabel = "MANUAL OVERRIDE";
        sourceClass = "manual";
    }

    entry.card.classList.toggle("is-owned", status.owned);

    entry.number.textContent = `#${String(index + 1).padStart(3, "0")}`;
    entry.mark.hidden = !status.owned;

    entry.tag.className = `source-tag${sourceClass ? ` ${sourceClass}` : ""}`;
    entry.tag.textContent = sourceLabel;

    entry.button.textContent = status.owned ? "✓ OWNED" : "+ MARK";
}

function getCategoryLabel(categoryId) {
    return CATEGORIES.find((category) => category.id === categoryId)?.label || "Uncategorized";
}

/* Search and filtering */

function getFilteredHeads() {
    const query = normalize($("search").value);
    const filter = $("status-filter").value;

    return HEADS.filter((head) => {
        const status = getStatus(head);

        const matchesCategory = selectedCategory === "all" || head.category === selectedCategory;

        const matchesSearch = !query || normalize(head.name).includes(query) || normalize(getCategoryLabel(head.category)).includes(query);

        let matchesStatus = true;

        switch (filter) {
            case "owned":
                matchesStatus = status.owned;
                break;

            case "missing":
                matchesStatus = !status.owned;
                break;

            case "steam":
                matchesStatus = isSteamOwned(head);
                break;

            case "manual":
                matchesStatus = status.source === "manual";
                break;
        }

        return matchesCategory && matchesSearch && matchesStatus;
    });
}

function renderCollection() {
    const filtered = getFilteredHeads();
    const visible = filtered.slice(0, visibleLimit);
    const grid = $("head-grid");

    const cards = visible.map((head, index) => {
        let entry = cardCache.get(head.id);

        if (!entry) {
            entry = buildCard(head);
            cardCache.set(head.id, entry);
        }

        updateCard(entry, head, index);

        return entry.card;
    });

    // same elements every time, so loaded images stay loaded
    grid.replaceChildren(...cards);

    $("empty-state").hidden = filtered.length > 0;

    $("visible-count").textContent = `${visible.length} of ${filtered.length} entries`;

    $("result-label").textContent = `SHOWING ${visible.length} OF ${filtered.length} ENTRIES`;

    $("show-more").hidden = visible.length >= filtered.length;

    const category = CATEGORIES.find((item) => item.id === selectedCategory);

    $("section-title").textContent = category?.label || "All Prisoners";
    $("section-count").textContent = filtered.length;
}

function renderAll() {
    renderNavigation();
    renderStats();
    renderCollection();
}

/* Steam inventory */

/*
 * Accepts a SteamID64, a /profiles/<id> URL, a /id/<name> URL,
 * or a bare custom URL name. Returns { steamid } or { vanity }.
 */
function parseSteamInput(raw) {
    const value = String(raw || "").trim();

    if (!value) {
        return null;
    }

    if (/^\d{17}$/.test(value)) {
        return { steamid: value };
    }

    const profile = value.match(/steamcommunity\.com\/profiles\/(\d{17})/i);

    if (profile) {
        return { steamid: profile[1] };
    }

    const vanityUrl = value.match(/steamcommunity\.com\/id\/([A-Za-z0-9_-]{3,32})/i);

    if (vanityUrl) {
        return { vanity: vanityUrl[1] };
    }

    if (/^[A-Za-z0-9_-]{3,32}$/.test(value)) {
        return { vanity: value };
    }

    return null;
}

async function fetchSteamInventory(target) {
    const params = new URLSearchParams(target);

    const response = await fetch(
        API_BASE + "/api/steam-inventory?" + params.toString()
    );

    const body = await response.text();

    let data;

    try {
        data = JSON.parse(body);
    } catch {
        console.error("Non-JSON response from server:", body.slice(0, 500));
        throw new Error("The server returned HTML instead of JSON. Check the request URL and server terminal.");
    }

    if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
    }

    if (!Array.isArray(data.items)) {
        console.error("Unexpected inventory response:", data);
        throw new Error("Expected a Steam inventory containing an items array.");
    }

    // console.log("Resolved SteamID64:", data.steamid64);
    // console.log("Inventory items:", data.items.length);

    return data;
}

async function syncSteam() {
    if (syncing) {
        return;
    }

    const target = parseSteamInput($("steam-id").value);
    const error = $("steam-error");
    const button = $("steam-sync");

    error.textContent = "";

    if (!target) {
        error.textContent = "Enter a Steam profile URL, a custom URL name, or a 17-digit SteamID64.";
        return;
    }

    syncing = true;
    button.disabled = true;
    button.textContent = "Checking...";

    try {
        const inventory = await fetchSteamInventory(target);

        // console.log("Steam inventory items:");
        // console.table(inventory.items);
        // console.log("Full inventory data:", inventory.items);

        steamItems = inventory.items
            .map((item) => ({
                name: item.market_hash_name || item.name || "",
            }))
            .filter((item) => item.name);

        steamConnected = true;

        // Steam is now the source of truth for anything it reports
        const cleared = clearOverridesCoveredBySteam();

        saveProgress();
        renderAll();

        showToast(`Loaded ${steamItems.length} inventory items` + (cleared ? `, cleared ${cleared} manual override${cleared === 1 ? "" : "s"}` : ""));
    } catch (errorObject) {
        console.error("Steam sync failed:", errorObject);
        error.textContent = errorObject.message || "Steam lookup failed.";
    } finally {
        syncing = false;
        button.disabled = false;
        button.textContent = "Check inventory";
    }
}

/* Hero: show a random prisoner */

function renderHeroHead() {
    const slot = document.querySelector(".prisoner-head");
    const candidates = HEADS.filter((head) => head.icon_url);

    if (!slot || !candidates.length) {
        return;
    }

    const head = candidates[Math.floor(Math.random() * candidates.length)];
    const plainUrl = getSteamIconUrl(head.icon_url);

    const img = document.createElement("img");

    img.alt = "";

    img.addEventListener("load", () => img.classList.add("is-loaded"));

    // we ask Steam for a bigger image; if it refuses, use the default size
    img.addEventListener("error", () => {
        if (img.src !== plainUrl) {
            img.src = plainUrl;
        }
    });

    img.src = `${plainUrl}/360fx360f`;

    slot.replaceChildren(img);
}

/* Initialization */

function init() {
    if (initialized) {
        return;
    }

    initialized = true;

    loadProgress();
    renderAll();
    renderHeroHead();

    // The hero form handles both the button and the Enter key
    $("steam-form").addEventListener("submit", (event) => {
        event.preventDefault();
        syncSteam();
    });

    $("search").addEventListener("input", () => {
        visibleLimit = PAGE_SIZE;
        renderCollection();
    });

    // Keep the status dropdown and legend synchronized
    function updateLegend() {
        document.querySelectorAll(".legend[data-filter]").forEach((item) => {
            const active = item.dataset.filter === $("status-filter").value;

            item.classList.toggle("active", active);
            item.setAttribute("aria-pressed", String(active));
        });
    }

    $("status-filter").addEventListener("change", () => {
        visibleLimit = PAGE_SIZE;
        updateLegend();
        renderCollection();
    });

    // Click Owned or Missing to filter; click again to clear
    document.querySelectorAll(".legend[data-filter]").forEach((legend) => {
        legend.addEventListener("click", () => {
            const filter = legend.dataset.filter;
            const isActive = $("status-filter").value === filter;

            $("status-filter").value = isActive ? "all" : filter;

            visibleLimit = PAGE_SIZE;
            updateLegend();
            renderCollection();
        });
    });

    $("show-more").addEventListener("click", () => {
        visibleLimit += PAGE_SIZE;
        renderCollection();
    });

    $("clear-filters").addEventListener("click", () => {
        $("search").value = "";
        $("status-filter").value = "all";

        selectedCategory = "all";
        visibleLimit = PAGE_SIZE;

        updateLegend();
        renderAll();
    });

    $("reset-btn").addEventListener("click", () => {
        manualState = {};

        saveProgress();
        renderAll();

        showToast("Manual overrides cleared");
    });

    // Set the correct initial legend state
    updateLegend();
}
