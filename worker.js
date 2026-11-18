// Cloudflare Worker: Syncribullet Trakt & Multi-Tracker Addon
// Polished Stremio & Nuvio Addon with Rich Watchlists, Continue Watching, and Auto-Scrobble.

const DEFAULT_TRAKT_CLIENT_ID = '';
const TRAKT_API_URL = 'https://api.trakt.tv';
const SIMKL_API_URL = 'https://api.simkl.com';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CONFIG_FILE = 'config.json';

const syncDebounceCache = new Map();
function shouldSync(key) {
  const now = Date.now();
  const last = syncDebounceCache.get(key) || 0;
  if (now - last < 15 * 60 * 1000) return false;
  syncDebounceCache.set(key, now);
  if (syncDebounceCache.size > 2000) {
    for (const [k, v] of syncDebounceCache.entries()) {
      if (now - v > 30 * 60 * 1000) syncDebounceCache.delete(k);
    }
  }
  return true;
}

const GENRE_OPTIONS = [
  'Action', 'Adventure', 'Animation', 'Comedy', 'Crime',
  'Documentary', 'Drama', 'Family', 'Fantasy', 'History',
  'Horror', 'Mystery', 'Romance', 'Sci-Fi', 'Thriller', 'War', 'Western'
];

const BASE_CATALOGS = [
  {
    type: 'series',
    id: 'trakt_playback_series',
    name: 'Trakt - Continue Watching',
    extra: [{ name: 'skip', isRequired: false }],
    extraSupported: ['skip']
  },
  {
    type: 'movie',
    id: 'trakt_playback_movies',
    name: 'Trakt - Continue Watching',
    extra: [{ name: 'skip', isRequired: false }],
    extraSupported: ['skip']
  },
  {
    type: 'movie',
    id: 'trakt_watchlist_movies',
    name: 'Trakt - Watchlist',
    extra: [
      { name: 'genre', isRequired: false, options: GENRE_OPTIONS },
      { name: 'skip', isRequired: false }
    ],
    extraSupported: ['genre', 'skip']
  },
  {
    type: 'series',
    id: 'trakt_watchlist_series',
    name: 'Trakt - Watchlist',
    extra: [
      { name: 'genre', isRequired: false, options: GENRE_OPTIONS },
      { name: 'skip', isRequired: false }
    ],
    extraSupported: ['genre', 'skip']
  },
  {
    type: 'movie',
    id: 'trakt_history_movies',
    name: 'Trakt - History',
    extra: [
      { name: 'genre', isRequired: false, options: GENRE_OPTIONS },
      { name: 'skip', isRequired: false }
    ],
    extraSupported: ['genre', 'skip']
  },
  {
    type: 'series',
    id: 'trakt_history_series',
    name: 'Trakt - History',
    extra: [
      { name: 'genre', isRequired: false, options: GENRE_OPTIONS },
      { name: 'skip', isRequired: false }
    ],
    extraSupported: ['genre', 'skip']
  },
  {
    type: 'movie',
    id: 'trakt_collection_movies',
    name: 'Trakt - Collection',
    extra: [
      { name: 'genre', isRequired: false, options: GENRE_OPTIONS },
      { name: 'skip', isRequired: false }
    ],
    extraSupported: ['genre', 'skip']
  },
  {
    type: 'series',
    id: 'trakt_collection_series',
    name: 'Trakt - Collection',
    extra: [
      { name: 'genre', isRequired: false, options: GENRE_OPTIONS },
      { name: 'skip', isRequired: false }
    ],
    extraSupported: ['genre', 'skip']
  }
];

const SIMKL_CATALOGS = [
  {
    type: 'series',
    id: 'simkl_watching_shows',
    name: 'Simkl - Currently Watching',
    extra: [{ name: 'skip', isRequired: false }],
    extraSupported: ['skip']
  },
  {
    type: 'movie',
    id: 'simkl_plantowatch_movies',
    name: 'Simkl - Plan to Watch',
    extra: [
      { name: 'genre', isRequired: false, options: GENRE_OPTIONS },
      { name: 'skip', isRequired: false }
    ],
    extraSupported: ['genre', 'skip']
  },
  {
    type: 'series',
    id: 'simkl_plantowatch_shows',
    name: 'Simkl - Plan to Watch',
    extra: [
      { name: 'genre', isRequired: false, options: GENRE_OPTIONS },
      { name: 'skip', isRequired: false }
    ],
    extraSupported: ['genre', 'skip']
  },
  {
    type: 'movie',
    id: 'simkl_completed_movies',
    name: 'Simkl - Completed',
    extra: [
      { name: 'genre', isRequired: false, options: GENRE_OPTIONS },
      { name: 'skip', isRequired: false }
    ],
    extraSupported: ['genre', 'skip']
  }
];

function buildManifest(config) {
  const allCatalogs = [...BASE_CATALOGS];
  if (config && config.simklToken) {
    allCatalogs.push(...SIMKL_CATALOGS);
  }

  let catalogs = allCatalogs;
  if (config && Array.isArray(config.catalogs) && config.catalogs.length > 0) {
    const selected = new Set(config.catalogs);
    catalogs = allCatalogs.filter(c => selected.has(c.id));
  }

  return {
    id: 'org.syncribullet.multisync',
    version: '2.5.0',
    name: 'SyncriBullet - Multi-Tracker Sync',
    description: 'Syncs Trakt and Simkl Watchlists, Continue Watching, and History to Stremio and Nuvio across all devices without account logouts.',
    logo: 'https://raw.githubusercontent.com/nepalanurag/stremio-trakt-sync/main/icon.svg',
    background: 'https://images.metahub.space/background/medium/tt0903747/img',
    resources: ['catalog', 'subtitles'],
    types: ['movie', 'series'],
    catalogs,
    behaviorHints: {
      configurable: true,
      configurationRequired: false
    }
  };
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Content-Type': 'application/json; charset=utf-8'
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: CORS_HEADERS
  });
}

function parseConfig(segment) {
  if (!segment) return null;
  try {
    const raw = atob(segment.replace(/-/g, '+').replace(/_/g, '/'));
    const parsed = JSON.parse(raw);
    if (parsed.traktToken || parsed.token) return parsed;
  } catch (_) {}
  return null;
}

function parseMediaId(type, idWithExt) {
  const rawId = idWithExt.replace(/\.json$/, '');
  if (type === 'movie') return { type: 'movie', imdbId: rawId };
  const parts = rawId.split(':');
  if (parts.length >= 3) {
    return {
      type: 'series',
      imdbId: parts[0],
      season: parseInt(parts[1], 10),
      episode: parseInt(parts[2], 10)
    };
  }
  return { type: 'series', imdbId: rawId };
}

function normalizeGenre(g) {
  if (!g) return '';
  const clean = g.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (clean === 'scifi' || clean === 'sciencefiction') return 'sci-fi';
  return g.charAt(0).toUpperCase() + g.slice(1).replace('-', ' ');
}

function mapToMeta(item, type) {
  const target = item.movie || item.show;
  if (!target || !target.ids) return null;

  const imdbId = target.ids.imdb;
  const id = imdbId || `trakt:${target.ids.trakt}`;
  const title = target.title || 'Unknown Title';
  const year = target.year ? String(target.year) : undefined;

  let poster = undefined;
  if (target.images?.poster?.[0]) {
    poster = `https://${target.images.poster[0]}`;
  } else if (imdbId) {
    poster = `https://images.metahub.space/poster/medium/${imdbId}/img`;
  }

  let background = undefined;
  if (target.images?.fanart?.[0]) {
    background = `https://${target.images.fanart[0]}`;
  } else if (imdbId) {
    background = `https://images.metahub.space/background/medium/${imdbId}/img`;
  }

  let logo = undefined;
  if (target.images?.logo?.[0]) {
    logo = `https://${target.images.logo[0]}`;
  } else if (imdbId) {
    logo = `https://images.metahub.space/logo/medium/${imdbId}/img`;
  }

  const imdbRating = target.rating ? (Math.round(target.rating * 10) / 10).toFixed(1) : undefined;

  let genres = undefined;
  if (Array.isArray(target.genres) && target.genres.length > 0) {
    genres = target.genres.map(normalizeGenre).filter(Boolean);
  }

  return {
    id,
    type,
    name: title,
    poster,
    background,
    logo,
    description: target.overview || '',
    releaseInfo: year,
    imdbRating,
    genres,
    trailer: target.trailer || undefined
  };
}

function mapSimklToMeta(item, type) {
  const target = item.movie || item.show || item;
  if (!target) return null;

  const imdbId = target.ids?.imdb;
  const id = imdbId || (target.ids?.simkl ? `simkl:${target.ids.simkl}` : null);
  if (!id) return null;

  const title = target.title || 'Unknown Title';
  const year = target.year ? String(target.year) : undefined;
  const poster = target.poster
    ? `https://simkl.in/posters/${target.poster}_m.jpg`
    : (imdbId ? `https://images.metahub.space/poster/medium/${imdbId}/img` : undefined);
  const background = imdbId ? `https://images.metahub.space/background/medium/${imdbId}/img` : undefined;

  return {
    id,
    type,
    name: title,
    poster,
    background,
    releaseInfo: year,
    description: target.overview || ''
  };
}

async function syncToTrakt(media, token, clientId) {
  if (!media.imdbId || !media.imdbId.startsWith('tt')) return;
  let payload = null;
  if (media.type === 'movie') {
    payload = { movies: [{ ids: { imdb: media.imdbId } }] };
  } else if (media.season !== undefined && media.episode !== undefined) {
    payload = {
      shows: [{
        ids: { imdb: media.imdbId },
        seasons: [{
          number: media.season,
          episodes: [{ number: media.episode }]
        }]
      }]
    };
  }
  if (!payload) return;

  await fetch(`${TRAKT_API_URL}/sync/history`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': USER_AGENT,
      'trakt-api-version': '2',
      'trakt-api-key': clientId,
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
}

async function syncToSimkl(media, token) {
  if (!media.imdbId || !media.imdbId.startsWith('tt')) return;
  let payload = null;
  if (media.type === 'movie') {
    payload = { movies: [{ ids: { imdb: media.imdbId } }] };
  } else if (media.season !== undefined && media.episode !== undefined) {
    payload = {
      shows: [{
        ids: { imdb: media.imdbId },
        seasons: [{
          number: media.season,
          episodes: [{ number: media.episode }]
        }]
      }]
    };
  }
  if (!payload) return;

  await fetch(`${SIMKL_API_URL}/sync/history`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': USER_AGENT,
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
}

async function handleCatalog(catalogId, type, extraSegment, config, defaultClientId, simklClientId) {
  let skip = 0;
  let selectedGenre = null;

  if (extraSegment) {
    const skipMatch = extraSegment.match(/skip=(\d+)/);
    if (skipMatch) skip = parseInt(skipMatch[1], 10);

    const genreMatch = extraSegment.match(/genre=([^&]+)/);
    if (genreMatch) selectedGenre = decodeURIComponent(genreMatch[1]).toLowerCase();
  }

  const page = Math.floor(skip / 20) + 1;

  // Handle Simkl Catalogs
  if (catalogId.startsWith('simkl_')) {
    if (!config.simklToken) return [];
    let simklEndpoint = '';
    if (catalogId === 'simkl_watching_shows') simklEndpoint = '/sync/all-items/shows/watching';
    else if (catalogId === 'simkl_plantowatch_movies') simklEndpoint = '/sync/all-items/movies/plantowatch';
    else if (catalogId === 'simkl_plantowatch_shows') simklEndpoint = '/sync/all-items/shows/plantowatch';
    else if (catalogId === 'simkl_completed_movies') simklEndpoint = '/sync/all-items/movies/completed';
    if (!simklEndpoint) return [];

    const simklHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': USER_AGENT,
      'Authorization': `Bearer ${config.simklToken}`
    };
    if (simklClientId) simklHeaders['simkl-api-key'] = simklClientId;

    const res = await fetch(`${SIMKL_API_URL}${simklEndpoint}`, { headers: simklHeaders });
    if (!res.ok) return [];
    const data = await res.json();
    const list = data.movies || data.shows || (Array.isArray(data) ? data : []);
    const items = list.map(i => mapSimklToMeta(i, type)).filter(Boolean);
    return items.slice(skip, skip + 20);
  }

  // Handle Trakt Catalogs
  const token = config.traktToken || config.token;
  const clientId = config.traktClientId || config.clientId || defaultClientId;
  if (!token || !clientId) return [];

  let endpoint = '';
  if (catalogId === 'trakt_playback_movies') endpoint = '/sync/playback/movies?extended=full';
  else if (catalogId === 'trakt_playback_series') endpoint = '/sync/playback/episodes?extended=full';
  else if (catalogId === 'trakt_watchlist_movies') endpoint = `/sync/watchlist/movies?extended=full&page=${page}&limit=20`;
  else if (catalogId === 'trakt_watchlist_series') endpoint = `/sync/watchlist/shows?extended=full&page=${page}&limit=20`;
  else if (catalogId === 'trakt_history_movies') endpoint = `/sync/history/movies?extended=full&page=${page}&limit=20`;
  else if (catalogId === 'trakt_history_series') endpoint = `/sync/history/shows?extended=full&page=${page}&limit=20`;
  else if (catalogId === 'trakt_collection_movies') endpoint = `/sync/collection/movies?extended=full&page=${page}&limit=20`;
  else if (catalogId === 'trakt_collection_series') endpoint = `/sync/collection/shows?extended=full&page=${page}&limit=20`;
  if (!endpoint) return [];

  const res = await fetch(`${TRAKT_API_URL}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': USER_AGENT,
      'trakt-api-version': '2',
      'trakt-api-key': clientId,
      'Authorization': `Bearer ${token}`
    }
  });
  if (!res.ok) return [];
  const data = await res.json();

  let items = [];
  if (catalogId === 'trakt_playback_series') {
    const seen = new Set();
    for (const item of data) {
      if (item.show?.ids?.trakt && !seen.has(item.show.ids.trakt)) {
        seen.add(item.show.ids.trakt);
        const meta = mapToMeta(item, 'series');
        if (meta) items.push(meta);
      }
    }
  } else {
    items = data.map(i => mapToMeta(i, type)).filter(Boolean);
  }

  // Filter by genre if requested
  if (selectedGenre) {
    items = items.filter(item =>
      Array.isArray(item.genres) &&
      item.genres.some(g => g.toLowerCase().includes(selectedGenre))
    );
  }

  return items;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      const traktClientId = (env?.TRAKT_CLIENT_ID || DEFAULT_TRAKT_CLIENT_ID || '').trim();
      const simklClientId = (env?.SIMKL_CLIENT_ID || '').trim();
      const accessPassword = (env?.ACCESS_PASSWORD || '').trim();
      const allowedUsers = (env?.ALLOWED_USERS || '').trim().toLowerCase().split(',').map(s => s.trim()).filter(Boolean);

      const url = new URL(request.url);
      const pathname = url.pathname;

      // Icon Branding
      if (pathname === '/icon.svg') {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>
    <linearGradient id="traktRed" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ed1c40"/>
      <stop offset="100%" stop-color="#be123c"/>
    </linearGradient>
    <linearGradient id="cyanAccent" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#0284c7"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="128" fill="url(#bg)"/>
  <rect x="16" y="16" width="480" height="480" rx="112" fill="none" stroke="url(#traktRed)" stroke-width="12" opacity="0.4"/>
  <path d="M 176 140 L 336 140 C 352 140 364 152 364 168 C 364 184 352 196 336 196 L 284 196 L 284 348 C 284 364 272 376 256 376 C 240 376 228 364 228 348 L 228 196 L 176 196 C 160 196 148 184 148 168 C 148 152 160 140 176 140 Z" fill="url(#traktRed)"/>
  <path d="M 390 220 A 150 150 0 0 0 256 106 L 256 70 L 190 125 L 256 180 L 256 144 A 112 112 0 0 1 354 232 Z" fill="url(#cyanAccent)"/>
  <path d="M 122 292 A 150 150 0 0 0 256 406 L 256 442 L 322 387 L 256 332 L 256 368 A 112 112 0 0 1 158 280 Z" fill="url(#cyanAccent)"/>
</svg>`;
        return new Response(svg, {
          headers: {
            'Content-Type': 'image/svg+xml',
            'Cache-Control': 'public, max-age=604800',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

      // Route Parsing
      const parts = pathname.replace(/^\/+|\/+$/g, '').split('/');
      let config = null;
      let offset = 0;

      const potentialConfig = parseConfig(parts[0]);
      if (potentialConfig) {
        config = potentialConfig;
        offset = 1;
      }

      const routeParts = parts.slice(offset);

      // Web Dashboard (Root, /configure, or /:config/configure)
      const isConfigurePage =
        pathname === '/' ||
        pathname === '/configure' ||
        (potentialConfig && (routeParts.length === 0 || (routeParts.length === 1 && routeParts[0] === 'configure')));

      if (isConfigurePage) {
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SyncriBullet - Stremio & Nuvio Multi-Tracker Sync</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: #000000;
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 2.5rem 1rem 4rem 1rem;
    }

    /* SyncriBullet Header */
    .header-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      margin-bottom: 2rem;
    }
    .syncri-logo {
      display: inline-flex;
      align-items: center;
      gap: 0;
      user-select: none;
      margin-bottom: 0.85rem;
    }
    .syncri-blocks {
      display: inline-flex;
      border-radius: 4px;
      overflow: hidden;
      box-shadow: 0 4px 14px rgba(0,0,0,0.6);
    }
    .blk {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 48px;
      font-size: 2rem;
      font-weight: 800;
      color: #ffffff;
      text-shadow: 0 2px 4px rgba(0,0,0,0.5);
    }
    .blk-s { background: #96ceb4; }
    .blk-y { background: #e53935; }
    .blk-n { background: #1e88e5; }
    .blk-c { background: #00bcd4; }
    .blk-r { background: #ff7043; }
    .blk-i { background: #263238; }
    .syncri-text {
      font-size: 2.2rem;
      font-weight: 800;
      color: #ffffff;
      margin-left: 6px;
      letter-spacing: -0.5px;
    }
    .syncri-ver {
      font-size: 0.95rem;
      font-weight: 600;
      color: #94a3b8;
      margin-left: 8px;
      margin-top: 8px;
    }
    .github-link a {
      color: #cbd5e1;
      display: inline-flex;
      transition: opacity 0.2s;
    }
    .github-link a:hover {
      opacity: 0.75;
    }

    /* Main Container Cards */
    .dashboard-wrap {
      width: 100%;
      max-width: 620px;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }
    .sb-card {
      background: #253327;
      border: 1px solid #334436;
      border-radius: 16px;
      padding: 1.85rem 1.5rem;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      text-align: center;
    }
    .sb-card-title {
      font-size: 1.65rem;
      font-weight: 700;
      color: #e2ece4;
      margin-bottom: 0.75rem;
      letter-spacing: -0.3px;
    }
    .sb-card-subtitle {
      font-size: 1rem;
      font-weight: 600;
      color: #e2ece4;
      margin: 1rem 0 0.75rem 0;
    }

    /* Pill Buttons (SyncriBullet Style) */
    .pills-row {
      display: flex;
      justify-content: center;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.65rem;
    }
    .service-pill {
      background: #19241b;
      border: 1px solid #314234;
      border-radius: 9999px;
      padding: 0.45rem 1.15rem 0.45rem 0.65rem;
      color: #f1f5f9;
      font-size: 0.92rem;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.65rem;
      transition: all 0.15s ease-in-out;
      user-select: none;
    }
    .service-pill:hover {
      background: #202e23;
      border-color: #455a49;
      transform: translateY(-1px);
    }
    .service-pill.active-pill {
      border-color: #9edbb2;
    }
    .pill-icon {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.7rem;
      font-weight: 800;
      flex-shrink: 0;
    }
    .icon-simkl { background: #000; color: #fff; border: 1px solid #444; }
    .icon-trakt { background: #ed1c40; color: #fff; }
    .icon-stremio { background: #725bb7; color: #fff; }
    .icon-nuvio { background: #0d9488; color: #fff; }
    .icon-sb { background: #3b503e; color: #9edbb2; font-size: 0.65rem; }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #475569;
      margin-left: 0.15rem;
    }
    .status-dot.connected {
      background: #22c55e;
      box-shadow: 0 0 6px #22c55e;
    }

    /* Modal Backdrop & Container */
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.78);
      backdrop-filter: blur(5px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 1rem;
    }
    .modal-container {
      background: #19231b;
      border: 1px solid #2d3e30;
      border-radius: 16px;
      width: 100%;
      max-width: 540px;
      box-shadow: 0 25px 60px rgba(0,0,0,0.85);
      padding: 1.85rem;
      max-height: 88vh;
      overflow-y: auto;
      animation: modalFadeIn 0.15s ease-out;
    }
    @keyframes modalFadeIn {
      from { opacity: 0; transform: scale(0.97); }
      to { opacity: 1; transform: scale(1); }
    }
    .modal-header {
      text-align: center;
      margin-bottom: 1.25rem;
    }
    .modal-title {
      font-size: 1.75rem;
      font-weight: 700;
      color: #ffffff;
    }
    .modal-section-title {
      font-size: 1.05rem;
      font-weight: 700;
      color: #e2ece4;
      margin: 0.75rem 0 0.85rem 0;
    }

    /* Tabs (SyncriBullet Style) */
    .tabs-row {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1.25rem;
      flex-wrap: wrap;
    }
    .tab-btn {
      background: #6a8c76;
      color: #ffffff;
      border: none;
      border-radius: 6px;
      padding: 0.5rem 1rem;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .tab-btn:hover {
      background: #7ca089;
    }
    .tab-btn.tab-active {
      background: #9edbb2;
      color: #0f2516;
      font-weight: 700;
    }

    /* Tab Content Areas */
    .tab-pane {
      display: none;
    }
    .tab-pane.pane-active {
      display: block;
    }

    /* Catalog Checkbox List */
    .cat-checkbox-group {
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
      margin: 1rem 0;
    }
    .cat-item {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      cursor: pointer;
      user-select: none;
    }
    .cat-item input[type="checkbox"] {
      width: 17px;
      height: 17px;
      accent-color: #2563eb;
      margin-top: 2px;
      cursor: pointer;
      flex-shrink: 0;
    }
    .cat-details {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
    }
    .cat-name {
      font-size: 0.95rem;
      font-weight: 600;
      color: #ffffff;
    }
    .cat-type {
      font-size: 0.8rem;
      color: #8ea495;
    }

    /* Action Buttons */
    .btn-save {
      background: #9edbb2;
      color: #0d2214;
      border: none;
      border-radius: 9999px;
      padding: 0.6rem 1.4rem;
      font-size: 0.95rem;
      font-weight: 700;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .btn-save:hover {
      background: #b1e4c3;
    }
    .btn-danger-pill {
      background: #fca5a5;
      color: #7f1d1d;
      border: none;
      border-radius: 9999px;
      padding: 0.55rem 1.25rem;
      font-size: 0.88rem;
      font-weight: 700;
      cursor: pointer;
      margin-top: 0.75rem;
      transition: background 0.15s;
    }
    .btn-danger-pill:hover {
      background: #f87171;
    }
    .btn-ghost {
      background: transparent;
      border: 1px solid #425846;
      color: #cbd5e1;
      border-radius: 9999px;
      padding: 0.55rem 1.25rem;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-ghost:hover {
      background: rgba(255,255,255,0.05);
      border-color: #6a8c76;
    }

    /* Code activation box */
    .code-box {
      background: #111a13;
      border: 1px dashed #6a8c76;
      border-radius: 10px;
      padding: 1.25rem;
      margin: 1rem 0;
      text-align: center;
    }
    .code-display {
      font-size: 2.1rem;
      font-weight: 800;
      letter-spacing: 5px;
      color: #9edbb2;
      font-family: monospace;
      margin: 0.5rem 0;
    }
    .code-btn {
      display: inline-block;
      background: transparent;
      border: 1px solid #9edbb2;
      color: #9edbb2;
      border-radius: 6px;
      padding: 0.5rem 1rem;
      font-size: 0.88rem;
      font-weight: 600;
      text-decoration: none;
      margin-top: 0.4rem;
      cursor: pointer;
    }
    .code-btn:hover {
      background: rgba(158,219,178,0.12);
    }

    .modal-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 1.75rem;
      padding-top: 1.25rem;
      border-top: 1px solid #28382b;
    }

    /* Toast Notification */
    #toast {
      position: fixed;
      bottom: 2rem;
      background: #9edbb2;
      color: #0d2214;
      font-weight: 700;
      padding: 0.75rem 1.5rem;
      border-radius: 9999px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
      display: none;
      z-index: 2000;
      animation: toastIn 0.2s ease;
    }
    @keyframes toastIn {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  </style>
</head>
<body>

  <!-- SyncriBullet Header -->
  <div class="header-container">
    <div class="syncri-logo">
      <div class="syncri-blocks">
        <span class="blk blk-s">S</span>
        <span class="blk blk-y">y</span>
        <span class="blk blk-n">n</span>
        <span class="blk blk-c">c</span>
        <span class="blk blk-r">r</span>
        <span class="blk blk-i">i</span>
      </div>
      <span class="syncri-text">Bullet</span>
      <span class="syncri-ver">(v2.4.2)</span>
    </div>
    <div class="github-link">
      <a href="https://github.com/nepalanurag/stremio-trakt-sync" target="_blank" rel="noopener">
        <svg height="24" width="24" viewBox="0 0 16 16" fill="#cbd5e1">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
        </svg>
      </a>
    </div>
  </div>

  <!-- Dashboard Container -->
  <div class="dashboard-wrap" id="mainDashboard">
    
    <!-- 1. Receivers Card -->
    <div class="sb-card">
      <div class="sb-card-title">Receivers</div>
      
      <div class="sb-card-subtitle">Sync</div>
      <div class="pills-row">
        <!-- Simkl Pill -->
        <button class="service-pill" onclick="openModal('simkl')">
          <div class="pill-icon icon-simkl">S</div>
          <span>Simkl</span>
          <span id="simklStatusDot" class="status-dot"></span>
        </button>

        <!-- Trakt Pill -->
        <button class="service-pill" onclick="openModal('trakt')">
          <div class="pill-icon icon-trakt">T</div>
          <span>Trakt</span>
          <span id="traktStatusDot" class="status-dot"></span>
        </button>
      </div>

      <div class="sb-card-subtitle" style="margin-top: 1.5rem;">General Settings</div>
      <div class="pills-row">
        <button class="service-pill" onclick="openModal('general')">
          <div class="pill-icon icon-sb">SB</div>
          <span>syncribullet</span>
        </button>
      </div>
    </div>

    <!-- 2. Senders Card -->
    <div class="sb-card">
      <div class="sb-card-title">Senders</div>

      <div class="sb-card-subtitle">Applications</div>
      <div class="pills-row">
        <!-- Stremio Pill -->
        <button class="service-pill" onclick="openModal('stremio')">
          <div class="pill-icon icon-stremio">▶</div>
          <span>Stremio</span>
        </button>

        <!-- Nuvio Pill -->
        <button class="service-pill" onclick="openModal('nuvio')">
          <div class="pill-icon icon-nuvio">N</div>
          <span>Nuvio</span>
        </button>
      </div>
    </div>
  </div>

  <!-- Toast -->
  <div id="toast">Settings Saved</div>

  <!-- ================= MODALS ================= -->

  <!-- Modal Backdrop -->
  <div class="modal-backdrop" id="modalBackdrop" onclick="handleBackdropClick(event)">

    <!-- SIMKL MODAL -->
    <div class="modal-container" id="modalSimkl" style="display:none;">
      <div class="modal-header">
        <h2 class="modal-title">Simkl</h2>
        <div class="modal-section-title">Settings</div>
      </div>

      <!-- Tabs -->
      <div class="tabs-row">
        <button class="tab-btn tab-active" id="tabBtn-simkl-catalogs" onclick="switchTab('simkl', 'catalogs')">Catalogs</button>
        <button class="tab-btn" id="tabBtn-simkl-sync" onclick="switchTab('simkl', 'sync')">Live Sync</button>
        <button class="tab-btn" id="tabBtn-simkl-creds" onclick="switchTab('simkl', 'creds')">Credentials</button>
      </div>

      <!-- Tab 1: Catalogs -->
      <div class="tab-pane pane-active" id="pane-simkl-catalogs">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
          <span style="font-size:0.8rem; color:#8ea495;">Toggle catalogs for Stremio/Nuvio</span>
          <div style="display:flex; gap:0.4rem;">
            <button class="btn-ghost" style="padding:0.2rem 0.6rem; font-size:0.75rem;" onclick="toggleGroupCatalogs('simkl', true)">All</button>
            <button class="btn-ghost" style="padding:0.2rem 0.6rem; font-size:0.75rem;" onclick="toggleGroupCatalogs('simkl', false)">None</button>
          </div>
        </div>
        <div class="cat-checkbox-group" id="simklCatGroup"></div>
      </div>

      <!-- Tab 2: Live Sync -->
      <div class="tab-pane" id="pane-simkl-sync">
        <div class="cat-checkbox-group">
          <label class="cat-item">
            <input type="checkbox" id="syncSimklMovie" checked>
            <div class="cat-details">
              <span class="cat-name">movie</span>
              <span class="cat-type">Scrobble movies on playback start</span>
            </div>
          </label>
          <label class="cat-item">
            <input type="checkbox" id="syncSimklSeries" checked>
            <div class="cat-details">
              <span class="cat-name">series</span>
              <span class="cat-type">Scrobble TV episodes on playback start</span>
            </div>
          </label>
        </div>
      </div>

      <!-- Tab 3: Credentials -->
      <div class="tab-pane" id="pane-simkl-creds">
        <div id="simklCredsConnected" style="display:none;">
          <p style="font-size:0.92rem; color:#fca5a5; line-height:1.5; margin-bottom:1rem;">
            This will clear all credentials and remove all the settings associated with Simkl. Resetting to the default settings.
          </p>
          <button class="btn-danger-pill" onclick="disconnectSimkl()">Remove Credentials</button>
        </div>

        <div id="simklCredsDisconnected">
          <p style="font-size:0.9rem; color:#8ea495; margin-bottom:0.75rem;">Connect your Simkl account to sync watchlists and playback history.</p>
          <button class="code-btn" style="width:100%; padding:0.75rem;" id="btnStartSimkl" onclick="startSimkl()">Tap to Connect Simkl</button>
          
          <div class="code-box" id="simklCodeBox" style="display:none;">
            <p style="font-size:0.85rem; color:#cbd5e1; margin-bottom:0.25rem;">Your Simkl PIN code:</p>
            <div class="code-display" id="simklUserCode">----</div>
            <a class="code-btn" id="simklActivateLink" href="https://simkl.com/pin" target="_blank">1. Open simkl.com/pin in New Tab</a>
            <button class="code-btn" style="margin-left:0.4rem;" onclick="copySimklCode()">2. Copy Code</button>
            <p style="font-size:0.8rem; color:#8ea495; margin-top:0.75rem;">Waiting for authorization on Simkl...</p>
          </div>

          <div style="margin-top:1.25rem;">
            <p style="font-size:0.78rem; color:#64748b; margin-bottom:0.3rem;">Or paste existing Simkl Token:</p>
            <input id="simklTokenInput" style="width:100%; padding:0.6rem; background:#111a13; border:1px solid #334436; border-radius:6px; color:#fff;" placeholder="Paste Simkl Token" oninput="onSimklTokenInput()">
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-save" onclick="saveAndClose()">Save Settings</button>
        <button class="btn-ghost" onclick="closeModal()">Close</button>
      </div>
    </div>

    <!-- TRAKT MODAL -->
    <div class="modal-container" id="modalTrakt" style="display:none;">
      <div class="modal-header">
        <h2 class="modal-title">Trakt</h2>
        <div class="modal-section-title">Settings</div>
      </div>

      <!-- Tabs -->
      <div class="tabs-row">
        <button class="tab-btn tab-active" id="tabBtn-trakt-catalogs" onclick="switchTab('trakt', 'catalogs')">Catalogs</button>
        <button class="tab-btn" id="tabBtn-trakt-sync" onclick="switchTab('trakt', 'sync')">Live Sync</button>
        <button class="tab-btn" id="tabBtn-trakt-creds" onclick="switchTab('trakt', 'creds')">Credentials</button>
      </div>

      <!-- Tab 1: Catalogs -->
      <div class="tab-pane pane-active" id="pane-trakt-catalogs">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
          <span style="font-size:0.8rem; color:#8ea495;">Toggle catalogs for Stremio/Nuvio</span>
          <div style="display:flex; gap:0.4rem;">
            <button class="btn-ghost" style="padding:0.2rem 0.6rem; font-size:0.75rem;" onclick="toggleGroupCatalogs('trakt', true)">All</button>
            <button class="btn-ghost" style="padding:0.2rem 0.6rem; font-size:0.75rem;" onclick="toggleGroupCatalogs('trakt', false)">None</button>
          </div>
        </div>
        <div class="cat-checkbox-group" id="traktCatGroup"></div>
      </div>

      <!-- Tab 2: Live Sync -->
      <div class="tab-pane" id="pane-trakt-sync">
        <div class="cat-checkbox-group">
          <label class="cat-item">
            <input type="checkbox" id="syncTraktMovie" checked>
            <div class="cat-details">
              <span class="cat-name">movie</span>
              <span class="cat-type">Scrobble movies on playback start</span>
            </div>
          </label>
          <label class="cat-item">
            <input type="checkbox" id="syncTraktSeries" checked>
            <div class="cat-details">
              <span class="cat-name">series</span>
              <span class="cat-type">Scrobble TV episodes on playback start</span>
            </div>
          </label>
        </div>
      </div>

      <!-- Tab 3: Credentials -->
      <div class="tab-pane" id="pane-trakt-creds">
        <div id="traktCredsConnected" style="display:none;">
          <div style="background:#111a13; border:1px solid #334436; padding:0.85rem; border-radius:8px; margin-bottom:1rem;">
            Connected to Trakt: <strong id="traktUserName" style="color:#9edbb2;"></strong>
          </div>
          <p style="font-size:0.92rem; color:#fca5a5; line-height:1.5; margin-bottom:1rem;">
            This will clear all credentials and remove all the settings associated with Trakt. Resetting to the default settings.
          </p>
          <button class="btn-danger-pill" onclick="disconnectTrakt()">Remove Credentials</button>
        </div>

        <div id="traktCredsDisconnected">
          <p style="font-size:0.9rem; color:#8ea495; margin-bottom:0.75rem;">Connect your Trakt account to bypass the 1-device limit and sync library.</p>
          <button class="code-btn" style="width:100%; padding:0.75rem;" id="btnStartTrakt" onclick="startTrakt()">Tap to Connect Trakt</button>
          
          <div class="code-box" id="traktCodeBox" style="display:none;">
            <p style="font-size:0.85rem; color:#cbd5e1; margin-bottom:0.25rem;">Your activation code:</p>
            <div class="code-display" id="traktUserCode">----</div>
            <a class="code-btn" id="traktActivateLink" href="https://auth.trakt.tv/activate" target="_blank">1. Open Trakt Activate</a>
            <button class="code-btn" style="margin-left:0.4rem;" onclick="copyTraktCode()">2. Copy Code</button>
            <p style="font-size:0.8rem; color:#8ea495; margin-top:0.75rem;">Waiting for you to tap Yes on Trakt...</p>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-save" onclick="saveAndClose()">Save Settings</button>
        <button class="btn-ghost" onclick="closeModal()">Close</button>
      </div>
    </div>

    <!-- STREMIO / SENDER MODAL -->
    <div class="modal-container" id="modalStremio" style="display:none;">
      <div class="modal-header">
        <h2 class="modal-title">Stremio & Nuvio</h2>
        <div class="modal-section-title">Install Addon</div>
      </div>

      <p style="font-size:0.92rem; color:#cbd5e1; line-height:1.5; margin-bottom:1.25rem;">
        Your custom multi-tracker addon is configured and ready to install. Catalogs and playback scrobbler will sync seamlessly.
      </p>

      <div style="display:flex; flex-direction:column; gap:0.75rem;">
        <a id="stremioInstallBtn" class="code-btn" style="background:#9edbb2; color:#0f2516; text-align:center; padding:0.85rem; font-size:1.05rem; font-weight:700; border:none;" href="#">
          🚀 Install in Stremio (1-Click)
        </a>
      </div>

      <div style="margin-top:1.5rem;">
        <div style="font-size:0.85rem; font-weight:600; color:#e2ece4; margin-bottom:0.4rem;">Manifest URL (for Nuvio / Stremio Web):</div>
        <div id="stremioManifestDisplay" style="background:#111a13; border:1px solid #334436; border-radius:6px; padding:0.75rem; font-family:monospace; font-size:0.8rem; color:#9edbb2; word-break:break-all; user-select:all;"></div>
        <button class="code-btn" id="btnCopyManifest" style="width:100%; margin-top:0.5rem;" onclick="copyManifest()">📋 Copy Manifest URL</button>
      </div>

      <div class="modal-footer">
        <button class="btn-save" onclick="closeModal()">Done</button>
      </div>
    </div>

    <!-- GENERAL SETTINGS MODAL -->
    <div class="modal-container" id="modalGeneral" style="display:none;">
      <div class="modal-header">
        <h2 class="modal-title">SyncriBullet</h2>
        <div class="modal-section-title">Instance Info</div>
      </div>

      <div style="font-size:0.92rem; color:#cbd5e1; line-height:1.6;">
        <p style="margin-bottom:0.75rem;"><strong>Engine:</strong> Cloudflare Serverless Edge Worker</p>
        <p style="margin-bottom:0.75rem;"><strong>Trakt Sync:</strong> Direct CORS Bypass + Scrobble Debounce</p>
        <p style="margin-bottom:0.75rem;"><strong>Simkl Sync:</strong> RFC 8628 Device Flow + MetaHub Post-processing</p>
        <p style="margin-bottom:0.75rem;"><strong>Security:</strong> ${accessPassword ? '🔒 Protected by Master Passcode' : '🔓 Public Instance'}</p>
      </div>

      <div class="modal-footer">
        <button class="btn-save" onclick="closeModal()">Close</button>
      </div>
    </div>

  </div>

  <script>
    const SERVER_TRAKT_CLIENT_ID = "${traktClientId}";
    const SERVER_SIMKL_CLIENT_ID = "${simklClientId}";
    const SERVER_ACCESS_PASSWORD = "${accessPassword}";
    const SERVER_ALLOWED_USERS = ${JSON.stringify(allowedUsers)};
    const INITIAL_CONFIG = ${JSON.stringify(config || null)};

    const CATALOG_DEFINITIONS = [
      { id: 'trakt_playback_series', group: 'trakt', type: 'series', title: 'Trakt - Continue Watching' },
      { id: 'trakt_playback_movies', group: 'trakt', type: 'movie', title: 'Trakt - Continue Watching' },
      { id: 'trakt_watchlist_movies', group: 'trakt', type: 'movie', title: 'Trakt - Watchlist' },
      { id: 'trakt_watchlist_series', group: 'trakt', type: 'series', title: 'Trakt - Watchlist' },
      { id: 'trakt_history_movies', group: 'trakt', type: 'movie', title: 'Trakt - History' },
      { id: 'trakt_history_series', group: 'trakt', type: 'series', title: 'Trakt - History' },
      { id: 'trakt_collection_movies', group: 'trakt', type: 'movie', title: 'Trakt - Collection' },
      { id: 'trakt_collection_series', group: 'trakt', type: 'series', title: 'Trakt - Collection' },
      { id: 'simkl_watching_shows', group: 'simkl', type: 'series', title: 'Simkl - Currently Watching' },
      { id: 'simkl_plantowatch_movies', group: 'simkl', type: 'movie', title: 'Simkl - Plan to Watch' },
      { id: 'simkl_plantowatch_shows', group: 'simkl', type: 'series', title: 'Simkl - Plan to Watch' },
      { id: 'simkl_completed_movies', group: 'simkl', type: 'movie', title: 'Simkl - Completed' }
    ];

    let currentPassword = '';
    let traktToken = '';
    let traktUser = '';
    let activeTraktClientId = SERVER_TRAKT_CLIENT_ID;
    let simklToken = '';
    let activeSimklClientId = SERVER_SIMKL_CLIENT_ID;
    let selectedCatalogs = null;
    let pollInterval = null;
    let simklPollInterval = null;

    function checkLock() {
      if (!SERVER_ACCESS_PASSWORD) return true;
      const urlKey = new URLSearchParams(window.location.search).get('key') || new URLSearchParams(window.location.search).get('pass');
      const savedPass = sessionStorage.getItem('addon_pass') || localStorage.getItem('addon_pass') || (INITIAL_CONFIG && INITIAL_CONFIG.pass);
      if (urlKey === SERVER_ACCESS_PASSWORD || savedPass === SERVER_ACCESS_PASSWORD) {
        currentPassword = SERVER_ACCESS_PASSWORD;
        sessionStorage.setItem('addon_pass', currentPassword);
        localStorage.setItem('addon_pass', currentPassword);
        return true;
      }
      return false;
    }

    function renderCatalogLists() {
      const traktContainer = document.getElementById('traktCatGroup');
      const simklContainer = document.getElementById('simklCatGroup');
      traktContainer.innerHTML = '';
      simklContainer.innerHTML = '';

      CATALOG_DEFINITIONS.forEach(cat => {
        const isChecked = selectedCatalogs === null ? true : selectedCatalogs.includes(cat.id);
        const label = document.createElement('label');
        label.className = 'cat-item';

        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.id = 'chk-' + cat.id;
        chk.checked = isChecked;
        chk.onchange = () => onCatalogToggle(cat.id, chk.checked);

        const details = document.createElement('div');
        details.className = 'cat-details';

        const name = document.createElement('span');
        name.className = 'cat-name';
        name.innerText = cat.title;

        const type = document.createElement('span');
        type.className = 'cat-type';
        type.innerText = cat.type;

        details.appendChild(name);
        details.appendChild(type);

        label.appendChild(chk);
        label.appendChild(details);

        if (cat.group === 'trakt') traktContainer.appendChild(label);
        else if (cat.group === 'simkl') simklContainer.appendChild(label);
      });
    }

    function onCatalogToggle(catId, checked) {
      if (selectedCatalogs === null) {
        selectedCatalogs = CATALOG_DEFINITIONS.map(c => c.id);
      }
      if (checked) {
        if (!selectedCatalogs.includes(catId)) selectedCatalogs.push(catId);
      } else {
        selectedCatalogs = selectedCatalogs.filter(id => id !== catId);
      }
      localStorage.setItem('selected_catalogs', JSON.stringify(selectedCatalogs));
      updateUrls();
    }

    function toggleGroupCatalogs(group, select) {
      if (selectedCatalogs === null) {
        selectedCatalogs = CATALOG_DEFINITIONS.map(c => c.id);
      }
      const groupCats = CATALOG_DEFINITIONS.filter(c => c.group === group);
      groupCats.forEach(cat => {
        const chk = document.getElementById('chk-' + cat.id);
        if (chk) chk.checked = select;
        if (select) {
          if (!selectedCatalogs.includes(cat.id)) selectedCatalogs.push(cat.id);
        } else {
          selectedCatalogs = selectedCatalogs.filter(id => id !== cat.id);
        }
      });
      localStorage.setItem('selected_catalogs', JSON.stringify(selectedCatalogs));
      updateUrls();
    }

    function openModal(id) {
      document.getElementById('modalBackdrop').style.display = 'flex';
      ['modalSimkl', 'modalTrakt', 'modalStremio', 'modalGeneral'].forEach(mId => {
        const el = document.getElementById(mId);
        if (el) el.style.display = 'none';
      });

      if (id === 'simkl') {
        document.getElementById('modalSimkl').style.display = 'block';
        switchTab('simkl', 'catalogs');
      } else if (id === 'trakt') {
        document.getElementById('modalTrakt').style.display = 'block';
        switchTab('trakt', 'catalogs');
      } else if (id === 'stremio' || id === 'nuvio') {
        document.getElementById('modalStremio').style.display = 'block';
      } else if (id === 'general') {
        document.getElementById('modalGeneral').style.display = 'block';
      }
    }

    function closeModal() {
      document.getElementById('modalBackdrop').style.display = 'none';
    }

    function handleBackdropClick(e) {
      if (e.target.id === 'modalBackdrop') {
        closeModal();
      }
    }

    function switchTab(modalName, tabName) {
      ['catalogs', 'sync', 'creds'].forEach(t => {
        const btn = document.getElementById('tabBtn-' + modalName + '-' + t);
        const pane = document.getElementById('pane-' + modalName + '-' + t);
        if (btn && pane) {
          if (t === tabName) {
            btn.classList.add('tab-active');
            pane.classList.add('pane-active');
          } else {
            btn.classList.remove('tab-active');
            pane.classList.remove('pane-active');
          }
        }
      });
    }

    function showToast(msg) {
      const t = document.getElementById('toast');
      t.innerText = msg;
      t.style.display = 'block';
      setTimeout(() => { t.style.display = 'none'; }, 2000);
    }

    function saveAndClose() {
      closeModal();
      showToast('Settings Saved!');
      updateUrls();
    }

    async function startTrakt() {
      const btn = document.getElementById('btnStartTrakt');
      btn.innerText = 'Requesting code...';
      btn.disabled = true;

      const clientId = activeTraktClientId || SERVER_TRAKT_CLIENT_ID;
      try {
        let data = null;
        let directAttempted = false;
        try {
          const directRes = await fetch('https://api.trakt.tv/oauth/device/code', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'trakt-api-version': '2',
              'trakt-api-key': clientId
            },
            body: JSON.stringify({ client_id: clientId })
          });
          directAttempted = true;
          if (directRes.ok) data = await directRes.json();
        } catch (_) {}

        if (!data && !directAttempted) {
          const res = await fetch('/api/auth/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, pass: currentPassword })
          });
          if (res.ok) data = await res.json();
        }

        if (!data || !data.user_code) throw new Error('Could not get Trakt code');

        document.getElementById('traktUserCode').innerText = data.user_code;
        document.getElementById('traktActivateLink').href = data.verification_url || 'https://auth.trakt.tv/activate';
        document.getElementById('btnStartTrakt').style.display = 'none';
        document.getElementById('traktCodeBox').style.display = 'block';

        pollTraktToken(data.device_code, data.interval || 6, clientId);
      } catch (e) {
        alert(e.message);
        btn.disabled = false;
        btn.innerText = 'Tap to Connect Trakt';
      }
    }

    function copyTraktCode() {
      const code = document.getElementById('traktUserCode').innerText;
      navigator.clipboard.writeText(code);
      showToast('Code copied: ' + code);
    }

    function pollTraktToken(deviceCode, interval, clientId) {
      if (pollInterval) clearInterval(pollInterval);
      pollInterval = setInterval(async () => {
        try {
          let tokenData = null;
          let directAttempted = false;
          try {
            const directRes = await fetch('https://api.trakt.tv/oauth/device/token', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'trakt-api-version': '2',
                'trakt-api-key': clientId
              },
              body: JSON.stringify({ code: deviceCode, client_id: clientId })
            });
            directAttempted = true;
            if (directRes.ok) tokenData = await directRes.json();
          } catch (_) {}

          if (!tokenData && !directAttempted) {
            const res = await fetch('/api/auth/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ deviceCode, clientId, pass: currentPassword })
            });
            if (res.ok) tokenData = await res.json();
          }

          if (tokenData && tokenData.access_token) {
            clearInterval(pollInterval);
            let username = '';
            try {
              const uRes = await fetch('https://api.trakt.tv/users/me', {
                headers: {
                  'Content-Type': 'application/json',
                  'trakt-api-version': '2',
                  'trakt-api-key': clientId,
                  'Authorization': 'Bearer ' + tokenData.access_token
                }
              });
              if (uRes.ok) {
                const u = await uRes.json();
                username = u.username || '';
              }
            } catch (_) {}

            traktToken = tokenData.access_token;
            traktUser = username;
            localStorage.setItem('trakt_token', traktToken);
            localStorage.setItem('trakt_user', traktUser);

            renderCredentialsState();
            updateUrls();
            showToast('Trakt Connected!');
          }
        } catch (_) {}
      }, (interval || 6) * 1000);
    }

    function disconnectTrakt() {
      traktToken = '';
      traktUser = '';
      localStorage.removeItem('trakt_token');
      localStorage.removeItem('trakt_user');
      renderCredentialsState();
      updateUrls();
      showToast('Trakt Disconnected');
    }

    async function startSimkl() {
      const btn = document.getElementById('btnStartSimkl');
      btn.innerText = 'Requesting Simkl PIN...';
      btn.disabled = true;

      const clientId = activeSimklClientId || SERVER_SIMKL_CLIENT_ID;
      try {
        let data = null;
        let directAttempted = false;
        if (clientId) {
          try {
            const directRes = await fetch('https://api.simkl.com/oauth2/device', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ client_id: clientId })
            });
            directAttempted = true;
            if (directRes.ok) data = await directRes.json();
          } catch (_) {}
        }

        if (!data && !directAttempted) {
          const res = await fetch('/api/simkl/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, pass: currentPassword })
          });
          if (res.ok) data = await res.json();
        }

        if (!data || !data.user_code || !data.device_code) throw new Error('Could not get Simkl PIN');

        document.getElementById('simklUserCode').innerText = data.user_code;
        const actLink = document.getElementById('simklActivateLink');
        if (actLink) {
          actLink.href = data.verification_uri_complete || data.verification_uri || 'https://simkl.com/pin';
        }
        document.getElementById('btnStartSimkl').style.display = 'none';
        document.getElementById('simklCodeBox').style.display = 'block';

        pollSimklToken(data.device_code, data.interval || 5, clientId);
      } catch (e) {
        alert(e.message);
        btn.disabled = false;
        btn.innerText = 'Tap to Connect Simkl';
      }
    }

    function copySimklCode() {
      const code = document.getElementById('simklUserCode').innerText;
      navigator.clipboard.writeText(code);
      showToast('Simkl Code copied: ' + code);
    }

    function pollSimklToken(deviceCode, interval, clientId) {
      if (simklPollInterval) clearInterval(simklPollInterval);
      simklPollInterval = setInterval(async () => {
        try {
          let token = null;
          let directAttempted = false;
          if (clientId && deviceCode) {
            try {
              const directRes = await fetch('https://api.simkl.com/oauth2/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  client_id: clientId,
                  device_code: deviceCode,
                  grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
                })
              });
              directAttempted = true;
              if (directRes.ok) {
                const directData = await directRes.json();
                if (directData.access_token) token = directData.access_token;
              }
            } catch (_) {}
          }

          if (!token && !directAttempted) {
            const res = await fetch('/api/simkl/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ deviceCode, clientId, pass: currentPassword })
            });
            if (res.ok) {
              const resData = await res.json();
              if (resData.access_token) token = resData.access_token;
            }
          }

          if (token) {
            clearInterval(simklPollInterval);
            simklToken = token;
            localStorage.setItem('simkl_token', simklToken);
            renderCredentialsState();
            updateUrls();
            showToast('Simkl Connected!');
          }
        } catch (_) {}
      }, (interval || 5) * 1000);
    }

    function disconnectSimkl() {
      simklToken = '';
      localStorage.removeItem('simkl_token');
      renderCredentialsState();
      updateUrls();
      showToast('Simkl Disconnected');
    }

    function onSimklTokenInput() {
      const val = document.getElementById('simklTokenInput').value.trim();
      simklToken = val;
      if (val) localStorage.setItem('simkl_token', val);
      else localStorage.removeItem('simkl_token');
      renderCredentialsState();
      updateUrls();
    }

    function renderCredentialsState() {
      // Trakt
      const traktDot = document.getElementById('traktStatusDot');
      if (traktToken) {
        if (traktDot) traktDot.classList.add('connected');
        document.getElementById('traktCredsConnected').style.display = 'block';
        document.getElementById('traktCredsDisconnected').style.display = 'none';
        document.getElementById('traktUserName').innerText = traktUser ? '@' + traktUser : 'Active';
      } else {
        if (traktDot) traktDot.classList.remove('connected');
        document.getElementById('traktCredsConnected').style.display = 'none';
        document.getElementById('traktCredsDisconnected').style.display = 'block';
      }

      // Simkl
      const simklDot = document.getElementById('simklStatusDot');
      if (simklToken) {
        if (simklDot) simklDot.classList.add('connected');
        document.getElementById('simklCredsConnected').style.display = 'block';
        document.getElementById('simklCredsDisconnected').style.display = 'none';
      } else {
        if (simklDot) simklDot.classList.remove('connected');
        document.getElementById('simklCredsConnected').style.display = 'none';
        document.getElementById('simklCredsDisconnected').style.display = 'block';
      }
    }

    function copyManifest() {
      const url = document.getElementById('stremioManifestDisplay').innerText;
      navigator.clipboard.writeText(url);
      const btn = document.getElementById('btnCopyManifest');
      btn.innerText = '✓ Copied to Clipboard!';
      setTimeout(() => { btn.innerText = '📋 Copy Manifest URL'; }, 2000);
    }

    function updateUrls() {
      const activeCatalogs = selectedCatalogs === null ? CATALOG_DEFINITIONS.map(c => c.id) : selectedCatalogs;

      const configObj = {
        traktToken: traktToken || undefined,
        traktClientId: traktToken ? (activeTraktClientId || SERVER_TRAKT_CLIENT_ID || undefined) : undefined,
        traktUser: traktUser || undefined,
        simklToken: simklToken || undefined,
        simklClientId: simklToken ? (activeSimklClientId || SERVER_SIMKL_CLIENT_ID || undefined) : undefined,
        catalogs: activeCatalogs,
        pass: SERVER_ACCESS_PASSWORD ? currentPassword : undefined
      };

      const enc = btoa(JSON.stringify(configObj)).split('+').join('-').split('/').join('_').replace(/=+$/, '');
      const origin = window.location.origin;
      const manifest = origin + '/' + enc + '/manifest.json';
      const stremio = manifest.replace('https://', 'stremio://').replace('http://', 'stremio://');

      document.getElementById('stremioManifestDisplay').innerText = manifest;
      document.getElementById('stremioInstallBtn').href = stremio;
    }

    function init() {
      checkLock();

      if (INITIAL_CONFIG) {
        if (INITIAL_CONFIG.traktToken) {
          localStorage.setItem('trakt_token', INITIAL_CONFIG.traktToken);
          if (INITIAL_CONFIG.traktUser) localStorage.setItem('trakt_user', INITIAL_CONFIG.traktUser);
        }
        if (INITIAL_CONFIG.simklToken) {
          localStorage.setItem('simkl_token', INITIAL_CONFIG.simklToken);
        }
        if (Array.isArray(INITIAL_CONFIG.catalogs)) {
          localStorage.setItem('selected_catalogs', JSON.stringify(INITIAL_CONFIG.catalogs));
        }
      }

      traktToken = localStorage.getItem('trakt_token') || '';
      traktUser = localStorage.getItem('trakt_user') || '';
      simklToken = localStorage.getItem('simkl_token') || '';

      const savedCats = localStorage.getItem('selected_catalogs');
      if (savedCats) {
        try { selectedCatalogs = JSON.parse(savedCats); } catch (_) {}
      }

      renderCatalogLists();
      renderCredentialsState();
      updateUrls();
    }

    init();
  </script>
</body>
</html>`;
        return new Response(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      // Trakt Device Code: Start
      if (pathname === '/api/auth/start' && request.method === 'POST') {
        let reqClientId = traktClientId;
        try {
          const body = await request.json();
          if (body && body.clientId) reqClientId = body.clientId.trim();
        } catch (_) {}

        if (!reqClientId) {
          return jsonResponse({ error: 'TRAKT_CLIENT_ID environment variable is missing in Cloudflare' }, 400);
        }
        try {
          const res = await fetch(`${TRAKT_API_URL}/oauth/device/code`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'User-Agent': 'StremioTraktSync/2.3.0',
              'trakt-api-version': '2',
              'trakt-api-key': reqClientId
            },
            body: JSON.stringify({ client_id: reqClientId })
          });
          const text = await res.text();
          try {
            const data = JSON.parse(text);
            return jsonResponse(data, res.status);
          } catch (_) {
            return jsonResponse({ error: `Trakt returned non-JSON (${res.status}): ${text.slice(0, 150)}` }, 502);
          }
        } catch (err) {
          return jsonResponse({ error: `Failed to contact Trakt: ${err.message}` }, 500);
        }
      }

      // Trakt Device Code: Poll
      if (pathname === '/api/auth/token' && request.method === 'POST') {
        let reqClientId = traktClientId;
        let deviceCode = '';
        try {
          const body = await request.json();
          if (body) {
            deviceCode = body.deviceCode;
            if (body.clientId) reqClientId = body.clientId.trim();
          }
        } catch (_) {}

        if (!reqClientId) {
          return jsonResponse({ error: 'TRAKT_CLIENT_ID environment variable is missing' }, 400);
        }
        try {
          const res = await fetch(`${TRAKT_API_URL}/oauth/device/token`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'User-Agent': 'StremioTraktSync/2.3.0',
              'trakt-api-version': '2',
              'trakt-api-key': reqClientId
            },
            body: JSON.stringify({
              code: deviceCode,
              client_id: reqClientId
            })
          });

          if (!res.ok) {
            return jsonResponse({ status: 'pending' }, res.status);
          }

          const tokenData = await res.json();
          let username = '';
          try {
            const userRes = await fetch(`${TRAKT_API_URL}/users/me`, {
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': 'StremioTraktSync/2.3.0',
                'trakt-api-version': '2',
                'trakt-api-key': reqClientId,
                'Authorization': `Bearer ${tokenData.access_token}`
              }
            });
            if (userRes.ok) {
              const userData = await userRes.json();
              username = userData.username || '';
            }
          } catch (_) {}

          return jsonResponse({
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            username
          });
        } catch (err) {
          return jsonResponse({ error: err.message }, 500);
        }
      }

      // Simkl Device Code Flow
      if (pathname === '/api/simkl/start' && request.method === 'POST') {
        let reqClientId = simklClientId;
        try {
          const body = await request.json();
          if (body && body.clientId) reqClientId = body.clientId.trim();
        } catch (_) {}

        if (!reqClientId) {
          return jsonResponse({ error: 'SIMKL_CLIENT_ID not configured in Cloudflare environment variables' }, 400);
        }
        try {
          const res = await fetch(`${SIMKL_API_URL}/oauth2/device`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'User-Agent': 'StremioTraktSync/2.3.0'
            },
            body: JSON.stringify({ client_id: reqClientId })
          });
          const text = await res.text();
          try {
            const data = JSON.parse(text);
            return jsonResponse(data, res.status);
          } catch (_) {
            return jsonResponse({ error: `Simkl returned non-JSON (${res.status}): ${text.slice(0, 150)}` }, 502);
          }
        } catch (err) {
          return jsonResponse({ error: `Failed to contact Simkl: ${err.message}` }, 500);
        }
      }

      if (pathname === '/api/simkl/token' && request.method === 'POST') {
        let reqClientId = simklClientId;
        let deviceCode = '';
        try {
          const body = await request.json();
          if (body) {
            deviceCode = body.deviceCode;
            if (body.clientId) reqClientId = body.clientId.trim();
          }
        } catch (_) {}

        if (!reqClientId || !deviceCode) {
          return jsonResponse({ error: 'SIMKL_CLIENT_ID or deviceCode missing' }, 400);
        }
        try {
          const res = await fetch(`${SIMKL_API_URL}/oauth2/token`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'User-Agent': 'StremioTraktSync/2.3.0'
            },
            body: JSON.stringify({
              client_id: reqClientId,
              device_code: deviceCode,
              grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
            })
          });

          if (!res.ok) {
            return jsonResponse({ status: 'pending' }, res.status);
          }
          const text = await res.text();
          return jsonResponse(JSON.parse(text), 200);
        } catch (err) {
          return jsonResponse({ error: err.message }, 500);
        }
      }

      // Passcode Safeguard Enforcement
      if (accessPassword) {
        if (!config || config.pass !== accessPassword) {
          return jsonResponse({ error: 'Unauthorized: Valid ACCESS_PASSWORD required' }, 401);
        }
      }

      // Manifest
      if (routeParts.length === 1 && routeParts[0] === 'manifest.json') {
        return jsonResponse(buildManifest(config));
      }

      // Subtitles Hook (Dynamic Scrobbler on Playback Start)
      if (routeParts[0] === 'subtitles' && routeParts.length >= 3) {
        const type = routeParts[1];
        const idWithExt = routeParts[2];
        const media = parseMediaId(type, idWithExt);

        if (config && media.imdbId) {
          const syncKey = `${media.type}:${media.imdbId}:${media.season || 0}:${media.episode || 0}`;
          if (shouldSync(syncKey)) {
            const token = config.traktToken || config.token;
            const clientId = config.traktClientId || config.clientId || traktClientId;

            if (ctx && ctx.waitUntil) {
              ctx.waitUntil((async () => {
                if (token && clientId) {
                  await syncToTrakt(media, token, clientId).catch(() => {});
                }
                if (config.simklToken) {
                  await syncToSimkl(media, config.simklToken).catch(() => {});
                }
              })());
            }
          }
        }

        return jsonResponse({ subtitles: [] });
      }

      // Catalogs (with Cloudflare Edge Cache)
      if (routeParts[0] === 'catalog' && routeParts.length >= 3) {
        const cache = caches.default;
        const cacheKey = new Request(request.url, { method: 'GET' });

        let cached = await cache.match(cacheKey);
        if (cached) {
          return cached;
        }

        const type = routeParts[1];
        const idWithExt = routeParts[2];
        const catalogId = idWithExt.replace(/\.json$/, '');
        const extraSegment = routeParts[3] ? routeParts[3].replace(/\.json$/, '') : '';

        if (!config) return jsonResponse({ metas: [] });
        const metas = await handleCatalog(catalogId, type, extraSegment, config, traktClientId, simklClientId);
        
        const response = new Response(JSON.stringify({ metas }), {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'Cache-Control': 'public, max-age=300, stale-while-revalidate=600'
          }
        });

        if (ctx && ctx.waitUntil) {
          ctx.waitUntil(cache.put(cacheKey, response.clone()));
        }

        return response;
      }

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (fatalError) {
      return jsonResponse({
        error: fatalError.message,
        stack: fatalError.stack
      }, 500);
    }
  }
};
