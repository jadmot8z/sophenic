export type SophenicPlaceResult = {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  category?: string;
  type?: string;
  website?: string;
  phone?: string;
  openingHours?: string;
  sourceUrl: string;
  mapsUrl?: string;
  directionsUrl?: string;
};

export type SophenicReferenceImage = {
  url: string;
  sourceUrl: string;
  title: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function finite(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}
function normalized(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function safePublicWebUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return null;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host) || host === "::1") return null;
    return url;
  } catch { return null; }
}

async function officialWebsiteImage(value: string, signal?: AbortSignal): Promise<SophenicReferenceImage[]> {
  const url = safePublicWebUrl(value);
  if (!url) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Site officiel trop lent.")), 8_000);
  const abort = () => controller.abort(signal?.reason || new Error("Recherche annulée."));
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { "User-Agent": "Sophenic-Desktop/5.4.5", Accept: "text/html,application/xhtml+xml" } });
    if (!response.ok) return [];
    const html = (await response.text()).slice(0, 1_500_000);
    const match = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image(?::src)?)["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image(?::src)?)["']/i);
    if (!match?.[1]) return [];
    const image = new URL(match[1].replace(/&amp;/g, "&"), response.url || url.toString());
    if (!safePublicWebUrl(image.toString())) return [];
    return [{ url: image.toString(), sourceUrl: response.url || url.toString(), title: `Visuel officiel — ${url.hostname}` }];
  } catch { return []; }
  finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}

async function fetchJson(url: string, signal?: AbortSignal, init: RequestInit = {}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Recherche externe trop lente.")), 15_000);
  const abort = () => controller.abort(signal?.reason || new Error("Recherche annulée."));
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": "Sophenic-Desktop/5.4.5 (Windows assistant; location lookup)",
        Accept: "application/json",
        ...(init.headers || {})
      }
    });
    if (!response.ok) throw new Error(`Recherche externe HTTP ${response.status}.`);
    return await response.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

function cleanPlaceQuery(value: string): string {
  return value
    .replace(/^(?:salut|bonjour|bonsoir|hello|hey|coucou)\b[\s,;:!-]*/i, "")
    .replace(/^(?:peux[- ]?tu\s+)?(?:me\s+)?(?:trouve|trouver|cherche|chercher|donne)(?:[- ]?moi)?\s+/i, "")
    .replace(/^(?:alors\s+)?(?:la\s+)?(?:localisation|adresse)(?:\s+(?:de|du|des|d['’]))?\s+/i, "")
    .replace(/\b(?:peux[- ]?tu\s+)?(?:me\s+)?(?:dire\s+)?(?:ou|où)\s+(?:est|sont|se|ce)\s*(?:trouve(?:nt)?)?\b/ig, "")
    .replace(/\b(?:adresse|localisation)\s+(?:de|du|des|d['’])\b/ig, "")
    .replace(/\b(?:des?|quelques?)\s+(?=(?:magasins?|boutiques?|restaurants?|hotels?|hôtels?|bars?|cafés?|pharmacies?)\b)/ig, "")
    .replace(/[?!]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCityHint(query: string): string {
  const clean = query.replace(/[?!]+$/g, "").trim();
  const prep = clean.match(/(?:\bà\b|\ba\b|\bdans\b|\bsur\b|\bvers\b|\bprès de\b|\bpres de\b)\s+([\p{L}' -]{2,60})$/iu);
  if (prep?.[1]) return prep[1].trim();
  const known = clean.match(/\b(paris|grenoble|lyon|marseille|lille|bordeaux|toulouse|nice|nantes|strasbourg|rennes|montpellier|marrakech|marrakesh|casablanca|rabat|agadir|dubai|dubaï|londres|london|bruxelles|geneve|genève|lausanne)\b/iu);
  if (known?.[1]) return known[1];
  // Brand + city requests are often written without a preposition: "Burger King Marrakech".
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && words.length <= 7 && !/\b(rue|avenue|boulevard|route|place|centre|mall)\b/i.test(clean)) return words[words.length - 1];
  return "";
}

function extractBrandHint(query: string, city: string): string {
  let clean = cleanPlaceQuery(query);
  if (city) clean = clean.replace(new RegExp(`(?:\\b(?:à|a|dans|sur|vers|près de|pres de)\\s+)?${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "iu"), "").trim();
  clean = clean
    .replace(/^(?:des?|les?)\s+(?:magasins?|boutiques?|restaurants?|hotels?|hôtels?|bars?|cafés?)\s+/i, "")
    .replace(/^(?:magasins?|boutiques?)\s+(?:gamer|gaming|jeux vidéo|jeux video)\s*/i, "")
    .trim();
  if (!clean || /^(?:gaming|gamer|jeux vidéo|jeux video|restaurant|magasin|boutique)$/i.test(clean)) return "";
  return clean.slice(0, 80);
}

function placeQueryVariants(query: string, original: string): string[] {
  const variants = [query, original];
  const city = extractCityHint(query);
  const brand = extractBrandHint(query, city);
  const n = normalized(query);
  if (brand && city) variants.unshift(`${brand}, ${city}`, `${brand} ${city}`);
  if (/magasin(?:s)?\s+(?:gamer|gaming)|\b(?:gaming|gamer)\b/i.test(query)) {
    if (city) variants.push(`jeux vidéo ${city}`, `video games ${city}`, `informatique gaming ${city}`, `computer shop ${city}`);
  }
  if (/sephora/i.test(query) && /champs[- ’']?elys|champs[- ’']?élys/i.test(query)) variants.unshift("Sephora Champs-Élysées Paris", "Sephora Avenue des Champs-Élysées Paris");
  if (/burger\s+king/.test(n) && city) variants.unshift(`Burger King ${city}`);
  return [...new Set(variants.map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 8);
}

function scorePlace(row: Record<string, unknown>, query: string): number {
  const names = record(row.namedetails);
  const haystack = normalized(`${text(names.name)} ${text(row.name)} ${text(row.display_name)}`);
  const q = normalized(query);
  const tokens = q.split(" ").filter((token) => token.length > 2 && !["dans", "avec", "pour", "localisation", "adresse", "trouve", "magasin", "boutique"].includes(token));
  let score = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 4 : -1), 0);
  const brand = extractBrandHint(query, extractCityHint(query));
  if (brand && haystack.includes(normalized(brand))) score += 18;
  const city = extractCityHint(query);
  if (city && haystack.includes(normalized(city))) score += 10;
  const importance = finite(row.importance) || 0;
  score += importance * 5;
  return score;
}

function nominatimToPlace(raw: unknown, fallbackName: string): SophenicPlaceResult | null {
  const row = record(raw);
  const lat = finite(row.lat);
  const lon = finite(row.lon);
  if (lat === undefined || lon === undefined) return null;
  const extras = record(row.extratags);
  const names = record(row.namedetails);
  const display = text(row.display_name);
  const name = text(names.name) || text(row.name) || display.split(",")[0] || fallbackName;
  const osmType = text(row.osm_type);
  const osmId = text(row.osm_id);
  const sourceUrl = osmType && osmId
    ? `https://www.openstreetmap.org/${osmType === "node" ? "node" : osmType === "way" ? "way" : "relation"}/${osmId}`
    : `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
  const mapsQuery = encodeURIComponent(`${name} ${display || `${lat},${lon}`}`);
  return {
    name,
    address: display || name,
    latitude: lat,
    longitude: lon,
    category: text(row.category) || undefined,
    type: text(row.type) || undefined,
    website: text(extras.website) || text(extras["contact:website"]) || text(extras["brand:website"]) || undefined,
    phone: text(extras.phone) || text(extras["contact:phone"]) || undefined,
    openingHours: text(extras.opening_hours) || undefined,
    sourceUrl,
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`,
    directionsUrl: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lon}`)}`
  };
}

async function geocodeCity(city: string, base: string, signal?: AbortSignal): Promise<{ lat: number; lon: number } | null> {
  if (!city) return null;
  const url = `${base}/search?format=jsonv2&limit=1&featuretype=city&q=${encodeURIComponent(city)}`;
  const payload = await fetchJson(url, signal).catch(() => []);
  if (!Array.isArray(payload) || !payload.length) return null;
  const row = record(payload[0]);
  const lat = finite(row.lat); const lon = finite(row.lon);
  return lat === undefined || lon === undefined ? null : { lat, lon };
}

function overpassAddress(tags: Record<string, unknown>, fallback: string): string {
  const parts = [text(tags["addr:housenumber"]), text(tags["addr:street"]), text(tags["addr:postcode"]), text(tags["addr:city"])].filter(Boolean);
  return parts.join(" ").replace(/\s+/g, " ").trim() || fallback;
}

async function overpassPlaces(query: string, geocoderBase: string, signal?: AbortSignal): Promise<SophenicPlaceResult[]> {
  const city = extractCityHint(query);
  if (!city) return [];
  const center = await geocodeCity(city, geocoderBase, signal);
  if (!center) return [];
  const brand = extractBrandHint(query, city);
  const gaming = /\b(?:gaming|gamer|jeux vidéo|jeux video)\b/i.test(query);
  const escape = (value: string) => value.replace(/[\\"\n\r]/g, (m) => `\\${m}`);
  const filters = brand
    ? `["name"~"${escape(brand)}",i]`
    : gaming
      ? `["shop"~"^(computer|electronics|video_games|games)$"]`
      : "[\"name\"]";
  const overpass = (process.env.SOPHENIC_OVERPASS_URL || "https://overpass-api.de/api/interpreter").replace(/\/+$/, "");
  const data = `[out:json][timeout:12];nwr(around:30000,${center.lat},${center.lon})${filters};out center tags 12;`;
  const payload = await fetchJson(overpass, signal, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: `data=${encodeURIComponent(data)}`
  }).catch(() => ({}));
  const rows = Array.isArray(record(payload).elements) ? record(payload).elements as unknown[] : [];
  return rows.map((raw): SophenicPlaceResult | null => {
    const row = record(raw); const tags = record(row.tags); const centerRow = record(row.center);
    const lat = finite(row.lat) ?? finite(centerRow.lat); const lon = finite(row.lon) ?? finite(centerRow.lon);
    if (lat === undefined || lon === undefined) return null;
    const name = text(tags.name) || text(tags.brand) || brand || query;
    const address = overpassAddress(tags, `${name}, ${city}`);
    const type = text(row.type); const id = text(row.id);
    const sourceUrl = id ? `https://www.openstreetmap.org/${type === "node" ? "node" : type === "way" ? "way" : "relation"}/${id}` : `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}`;
    return {
      name,
      address,
      latitude: lat,
      longitude: lon,
      category: text(tags.amenity) || text(tags.shop) || undefined,
      type: text(tags.cuisine) || text(tags.shop) || undefined,
      website: text(tags.website) || text(tags["contact:website"]) || text(tags["brand:website"]) || undefined,
      phone: text(tags.phone) || text(tags["contact:phone"]) || undefined,
      openingHours: text(tags.opening_hours) || undefined,
      sourceUrl,
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${address}`)}`,
      directionsUrl: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lon}`)}`
    };
  }).filter((item): item is SophenicPlaceResult => Boolean(item));
}

/**
 * Location engine. Public Nominatim/Overpass endpoints are development fallbacks.
 * A commercial build should point SOPHENIC_GEOCODER_URL / SOPHENIC_OVERPASS_URL
 * to hosted/self-hosted endpoints or replace the adapter with a licensed Places API.
 */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<SophenicPlaceResult[]> {
  const original = query.trim().slice(0, 300);
  if (!original) return [];
  const q = cleanPlaceQuery(original) || original;
  const base = (process.env.SOPHENIC_GEOCODER_URL || "https://nominatim.openstreetmap.org").replace(/\/+$/, "");
  const variants = placeQueryVariants(q, original);
  const merged: unknown[] = [];
  const seenIds = new Set<string>();

  for (const variant of variants) {
    const url = `${base}/search?format=jsonv2&addressdetails=1&extratags=1&namedetails=1&limit=8&dedupe=1&q=${encodeURIComponent(variant)}`;
    const payload = await fetchJson(url, signal).catch(() => []);
    if (!Array.isArray(payload)) continue;
    for (const raw of payload) {
      const row = record(raw);
      const id = `${text(row.osm_type)}:${text(row.osm_id)}:${text(row.lat)}:${text(row.lon)}`;
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      merged.push(raw);
      if (merged.length >= 20) break;
    }
    if (merged.length >= 12) break;
  }

  let places = merged
    .sort((a, b) => scorePlace(record(b), q) - scorePlace(record(a), q))
    .map((raw) => nominatimToPlace(raw, q))
    .filter((item): item is SophenicPlaceResult => Boolean(item));

  // Nominatim can miss individual chain stores. Overpass is a second OSM-backed
  // deterministic lookup for brand/category-in-city requests.
  if (places.length < 3 && (extractBrandHint(q, extractCityHint(q)) || /\b(?:gaming|gamer|jeux vidéo|jeux video)\b/i.test(q))) {
    const extra = await overpassPlaces(q, base, signal).catch(() => []);
    places = [...places, ...extra];
  }

  const seen = new Set<string>();
  return places.filter((item) => {
    const key = `${item.name.toLowerCase()}|${item.latitude.toFixed(5)}|${item.longitude.toFixed(5)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);
}

function cleanImageQuery(value: string): string {
  return value
    .replace(/^(?:salut|bonjour|bonsoir|hello|hey|coucou)\b[\s,;:!-]*/i, "")
    .replace(/^(?:montre|affiche|cherche|trouve|donne)(?:[- ]?moi)?\s+(?:(?:\d+|des?|quelques?|plusieurs)\s+)?(?:photos?|images?|illustrations?)\s+(?:de|du|des|d['’])\s*/i, "")
    .replace(/^(?:(?:\d+|des?|quelques?|plusieurs)\s+)?(?:photos?|images?)\s+(?:de|du|des|d['’])\s*/i, "")
    .replace(/[?!]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function wikipediaSuggestion(query: string, signal?: AbortSignal): Promise<string> {
  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: query,
    srlimit: "3",
    utf8: "1",
    format: "json",
    formatversion: "2"
  });
  const payload = await fetchJson(`https://en.wikipedia.org/w/api.php?${params.toString()}`, signal).catch(() => ({}));
  const root = record(payload);
  const queryNode = record(root.query);
  const searchinfo = record(queryNode.searchinfo);
  const suggestion = text(searchinfo.suggestion);
  if (suggestion) return suggestion;
  const rows = Array.isArray(queryNode.search) ? queryNode.search : [];
  return rows.length ? text(record(rows[0]).title) : "";
}

async function commonsImages(query: string, signal?: AbortSignal): Promise<SophenicReferenceImage[]> {
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6",
    gsrlimit: "12",
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: "1200",
    format: "json",
    formatversion: "2"
  });
  const payload = await fetchJson(`https://commons.wikimedia.org/w/api.php?${params.toString()}`, signal).catch(() => ({}));
  const root = record(payload);
  const queryNode = record(root.query);
  const pages = Array.isArray(queryNode.pages) ? queryNode.pages : [];
  const seen = new Set<string>();
  const out: SophenicReferenceImage[] = [];
  for (const raw of pages) {
    const page = record(raw);
    const info = Array.isArray(page.imageinfo) ? record(page.imageinfo[0]) : {};
    const url = text(info.thumburl) || text(info.url);
    const descriptionUrl = text(info.descriptionurl) || text(info.descriptionshorturl) || "https://commons.wikimedia.org/";
    if (!url || seen.has(url)) continue;
    if (!/\.(?:jpe?g|png|webp)(?:\?|$)/i.test(url)) continue;
    seen.add(url);
    out.push({
      url,
      sourceUrl: descriptionUrl,
      title: text(page.title).replace(/^File:/i, "") || query
    });
    if (out.length >= 5) break;
  }
  return out;
}

export async function searchReferenceImages(query: string, signal?: AbortSignal): Promise<SophenicReferenceImage[]> {
  const raw = query.trim().slice(0, 500);
  if (!raw) return [];
  if (/^https?:\/\//i.test(raw)) {
    const official = await officialWebsiteImage(raw, signal);
    if (official.length) return official;
  }
  const q = cleanImageQuery(raw).slice(0, 180) || raw.slice(0, 180);
  let images = await commonsImages(q, signal);
  if (images.length >= 2) return images.slice(0, 5);
  const suggestion = await wikipediaSuggestion(q, signal);
  if (suggestion && suggestion.toLowerCase() !== q.toLowerCase()) {
    const suggested = await commonsImages(suggestion, signal);
    images = [...images, ...suggested].filter((item, index, all) => all.findIndex((candidate) => candidate.url === item.url) === index);
  }
  return images.slice(0, 5);
}
