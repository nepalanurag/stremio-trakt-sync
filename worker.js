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
    id: 'org.multisync.stremio',
    name: 'MultiSync (Trakt & Simkl)',
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
    version: '2.5.1',
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
  <title>MultiSync - Stremio & Nuvio Trakt & Simkl Sync</title>
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #111827;
      --card-border: #1f2937;
      --card-hover: #162033;
      --accent-trakt: #ed1c40;
      --accent-simkl: #0284c7;
      --accent-stremio: #7c3aed;
      --accent-green: #10b981;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --text-dim: #64748b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text-main);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 2.5rem 1rem 4rem 1rem;
      line-height: 1.5;
    }

    /* Container */
    .app-container {
      width: 100%;
      max-width: 680px;
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }

    /* Header */
    .app-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 0.5rem;
    }
    .brand-wrap {
      display: flex;
      align-items: center;
      gap: 0.85rem;
    }
    .brand-logo {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      box-shadow: 0 4px 15px rgba(237, 28, 64, 0.25);
    }
    .brand-title {
      font-size: 1.45rem;
      font-weight: 800;
      letter-spacing: -0.5px;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .brand-badge {
      font-size: 0.72rem;
      font-weight: 700;
      background: #1e293b;
      color: #94a3b8;
      padding: 0.15rem 0.5rem;
      border-radius: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .brand-sub {
      font-size: 0.85rem;
      color: var(--text-muted);
      margin-top: -2px;
    }
    .github-link {
      color: var(--text-muted);
      transition: color 0.15s;
    }
    .github-link:hover {
      color: #fff;
    }

    /* Cards */
    .panel {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 1.5rem;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
    }
    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1rem;
    }
    .panel-title {
      font-size: 1.05rem;
      font-weight: 700;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    /* Trackers Grid */
    .trackers-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
    }
    @media (max-width: 580px) {
      .trackers-grid { grid-template-columns: 1fr; }
    }
    .tracker-card {
      background: #0d131f;
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      transition: border-color 0.15s;
    }
    .tracker-card:hover {
      border-color: #334155;
    }
    .tracker-card.active {
      border-color: rgba(16, 185, 129, 0.4);
    }
    .tracker-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.85rem;
    }
    .tracker-identity {
      display: flex;
      align-items: center;
      gap: 0.6rem;
    }
    .tracker-badge-icon {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 0.85rem;
      color: #fff;
    }
    .icon-trakt { background: var(--accent-trakt); }
    .icon-simkl { background: var(--accent-simkl); }
    .tracker-name {
      font-weight: 700;
      font-size: 1rem;
      color: #fff;
    }
    .status-pill {
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.2rem 0.55rem;
      border-radius: 9999px;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }
    .status-pill.connected {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .status-pill.disconnected {
      background: rgba(148, 163, 184, 0.1);
      color: var(--text-muted);
    }
    .pulse-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #10b981;
    }
    .tracker-user {
      font-size: 0.88rem;
      color: #e2e8f0;
      margin-bottom: 0.85rem;
    }
    .btn-connect {
      background: #1e293b;
      color: #f1f5f9;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 0.55rem 0.9rem;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      width: 100%;
      text-align: center;
      transition: all 0.15s;
    }
    .btn-connect:hover {
      background: #273549;
      color: #fff;
    }
    .btn-disconnect {
      background: transparent;
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: 8px;
      padding: 0.45rem 0.75rem;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      width: 100%;
      transition: all 0.15s;
    }
    .btn-disconnect:hover {
      background: rgba(239, 68, 68, 0.1);
      border-color: #ef4444;
    }

    /* Code Box for Auth */
    .auth-box {
      background: #020617;
      border: 1px dashed #38bdf8;
      border-radius: 8px;
      padding: 1rem;
      margin-top: 0.75rem;
      text-align: center;
    }
    .auth-code {
      font-size: 1.7rem;
      font-weight: 800;
      letter-spacing: 4px;
      color: #38bdf8;
      font-family: monospace;
      margin: 0.35rem 0;
    }
    .auth-actions {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }
    .btn-auth-link {
      flex: 1;
      background: #0284c7;
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 0.5rem;
      font-size: 0.8rem;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
    }
    .btn-auth-copy {
      background: transparent;
      border: 1px solid #334155;
      color: #cbd5e1;
      border-radius: 6px;
      padding: 0.5rem 0.75rem;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
    }

    /* Tabs */
    .tabs-nav {
      display: flex;
      gap: 0.5rem;
      border-bottom: 1px solid var(--card-border);
      padding-bottom: 0.75rem;
      margin-bottom: 1.25rem;
    }
    .tab-pill {
      background: transparent;
      color: var(--text-muted);
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 8px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
    }
    .tab-pill:hover {
      color: #fff;
      background: #1e293b;
    }
    .tab-pill.active {
      background: #1e293b;
      color: #38bdf8;
      font-weight: 700;
    }

    /* Catalog Sections */
    .catalog-group-title {
      font-size: 0.82rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.75px;
      color: #38bdf8;
      margin: 1.25rem 0 0.5rem 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .catalog-group-title:first-child {
      margin-top: 0;
    }
    .cat-list {
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
    }
    .cat-item {
      background: #0d131f;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 0.65rem 0.85rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      transition: all 0.15s;
      user-select: none;
    }
    .cat-item:hover {
      background: #131b2e;
      border-color: #334155;
    }
    .cat-left {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .cat-item input[type="checkbox"] {
      width: 17px;
      height: 17px;
      accent-color: #0284c7;
      cursor: pointer;
    }
    .cat-title {
      font-size: 0.9rem;
      font-weight: 600;
      color: #f1f5f9;
    }
    .cat-type {
      font-size: 0.72rem;
      font-weight: 700;
      color: var(--text-dim);
      background: #1e293b;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      text-transform: uppercase;
    }

    /* Live Sync Switches */
    .sync-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.85rem 0;
      border-bottom: 1px solid #1e293b;
    }
    .sync-row:last-child {
      border-bottom: none;
    }
    .sync-meta h4 {
      font-size: 0.92rem;
      font-weight: 600;
      color: #fff;
    }
    .sync-meta p {
      font-size: 0.8rem;
      color: var(--text-muted);
    }

    /* Installation Section */
    .install-box {
      background: linear-gradient(135deg, rgba(124, 58, 237, 0.1) 0%, rgba(2, 132, 199, 0.1) 100%);
      border: 1px solid rgba(124, 58, 237, 0.3);
      border-radius: 16px;
      padding: 1.5rem;
      text-align: center;
    }
    .btn-install-primary {
      background: linear-gradient(135deg, #7c3aed 0%, #6366f1 100%);
      color: #fff;
      border: none;
      border-radius: 10px;
      padding: 0.9rem 1.5rem;
      font-size: 1.05rem;
      font-weight: 700;
      display: block;
      width: 100%;
      text-decoration: none;
      box-shadow: 0 4px 20px rgba(124, 58, 237, 0.4);
      cursor: pointer;
      transition: all 0.15s;
    }
    .btn-install-primary:hover {
      box-shadow: 0 6px 25px rgba(124, 58, 237, 0.6);
      transform: translateY(-1px);
    }
    .manifest-box {
      background: #020617;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 0.75rem;
      font-family: monospace;
      font-size: 0.8rem;
      color: #38bdf8;
      word-break: break-all;
      margin: 0.85rem 0 0.5rem 0;
      user-select: all;
    }
    .btn-copy {
      background: #1e293b;
      color: #cbd5e1;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 0.5rem 1rem;
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
    }
    .btn-copy:hover {
      background: #273549;
      color: #fff;
    }

    /* Lock Screen */
    .lock-screen {
      text-align: center;
      padding: 2.5rem 1rem;
    }
    .lock-icon {
      font-size: 3rem;
      margin-bottom: 0.75rem;
    }
    .lock-input {
      background: #020617;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 0.75rem 1rem;
      color: #fff;
      font-size: 0.95rem;
      width: 100%;
      max-width: 280px;
      text-align: center;
      margin: 1rem auto;
      display: block;
    }
    .btn-unlock {
      background: #0284c7;
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 0.65rem 1.5rem;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
    }

    /* Toast */
    #toast {
      position: fixed;
      bottom: 2rem;
      background: #10b981;
      color: #022c22;
      font-weight: 700;
      padding: 0.65rem 1.4rem;
      border-radius: 9999px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
      display: none;
      z-index: 2000;
    }
  </style>
</head>
<body>

  <div class="app-container">

    <!-- Header -->
    <header class="app-header">
      <div class="brand-wrap">
        <img class="brand-logo" src="/icon.svg" alt="MultiSync">
        <div>
          <div class="brand-title">
            MultiSync
            <span class="brand-badge">v2.5.0</span>
          </div>
          <div class="brand-sub">Trakt & Simkl Multi-Device Sync for Stremio & Nuvio</div>
        </div>
      </div>
      <a class="github-link" href="https://github.com/nepalanurag/stremio-trakt-sync" target="_blank" rel="noopener">
        <svg height="24" width="24" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
        </svg>
      </a>
    </header>

    <!-- Lock Screen (if locked) -->
    <div id="lockCard" class="panel lock-screen" style="display:none;">
      <div class="lock-icon">🔒</div>
      <h2 style="font-size:1.35rem; color:#fff; margin-bottom:0.35rem;">Protected Addon Instance</h2>
      <p style="font-size:0.88rem; color:var(--text-muted);">Enter master password to access configuration.</p>
      <input id="passInput" class="lock-input" type="password" placeholder="Enter Access Password" onkeydown="if(event.key==='Enter') unlockDashboard()">
      <button class="btn-unlock" onclick="unlockDashboard()">Unlock Configuration</button>
    </div>

    <!-- Main Dashboard -->
    <div id="mainDashboard" style="display:flex; flex-direction:column; gap:1.25rem;">

      <!-- 1. Connected Trackers -->
      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">Trackers & Accounts</span>
          <span style="font-size:0.8rem; color:var(--text-dim);">Connect once, sync everywhere</span>
        </div>

        <div class="trackers-grid">
          
          <!-- Trakt Card -->
          <div class="tracker-card" id="traktCard">
            <div>
              <div class="tracker-top">
                <div class="tracker-identity">
                  <div class="tracker-badge-icon icon-trakt">T</div>
                  <span class="tracker-name">Trakt</span>
                </div>
                <span id="traktStatusPill" class="status-pill disconnected">Not Connected</span>
              </div>
              <div id="traktUserInfo" class="tracker-user" style="display:none;">
                User: <strong id="traktUsername" style="color:#fff;"></strong>
              </div>
            </div>

            <div>
              <div id="traktActionInitial">
                <button class="btn-connect" id="btnStartTrakt" onclick="startTrakt()">Connect Trakt</button>
              </div>

              <div id="traktCodeBox" class="auth-box" style="display:none;">
                <p style="font-size:0.78rem; color:var(--text-muted);">Trakt Activation Code:</p>
                <div id="traktUserCode" class="auth-code">----</div>
                <div class="auth-actions">
                  <a id="traktActivateLink" class="btn-auth-link" href="https://auth.trakt.tv/activate" target="_blank">1. Open Trakt</a>
                  <button class="btn-auth-copy" onclick="copyTraktCode()">2. Copy</button>
                </div>
                <p style="font-size:0.75rem; color:#38bdf8; margin-top:0.4rem;">Waiting for authorization...</p>
              </div>

              <div id="traktActionConnected" style="display:none;">
                <button class="btn-disconnect" onclick="disconnectTrakt()">Disconnect Account</button>
              </div>
            </div>
          </div>

          <!-- Simkl Card -->
          <div class="tracker-card" id="simklCard">
            <div>
              <div class="tracker-top">
                <div class="tracker-identity">
                  <div class="tracker-badge-icon icon-simkl">S</div>
                  <span class="tracker-name">Simkl</span>
                </div>
                <span id="simklStatusPill" class="status-pill disconnected">Optional</span>
              </div>
              <div id="simklUserInfo" class="tracker-user" style="display:none;">
                Status: <strong style="color:#34d399;">Connected</strong>
              </div>
            </div>

            <div>
              <div id="simklActionInitial">
                <button class="btn-connect" id="btnStartSimkl" onclick="startSimkl()">Connect Simkl</button>
              </div>

              <div id="simklCodeBox" class="auth-box" style="display:none;">
                <p style="font-size:0.78rem; color:var(--text-muted);">Simkl PIN Code:</p>
                <div id="simklUserCode" class="auth-code">----</div>
                <div class="auth-actions">
                  <a id="simklActivateLink" class="btn-auth-link" href="https://simkl.com/pin" target="_blank">1. Open PIN</a>
                  <button class="btn-auth-copy" onclick="copySimklCode()">2. Copy</button>
                </div>
                <p style="font-size:0.75rem; color:#38bdf8; margin-top:0.4rem;">Waiting for approval...</p>
              </div>

              <div id="simklActionConnected" style="display:none;">
                <button class="btn-disconnect" onclick="disconnectSimkl()">Disconnect Account</button>
              </div>
            </div>
          </div>

        </div>
      </div>

      <!-- 2. Configuration Settings (Tabs) -->
      <div class="panel">
        <div class="tabs-nav">
          <button class="tab-pill active" id="tabNavCatalogs" onclick="showTab('catalogs')">Catalogs (12 Rows)</button>
          <button class="tab-pill" id="tabNavSync" onclick="showTab('sync')">Playback & Live Scrobbler</button>
        </div>

        <!-- Catalogs Tab -->
        <div id="tabContentCatalogs">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
            <p style="font-size:0.85rem; color:var(--text-muted);">Select which rows appear in Stremio and Nuvio:</p>
            <div style="display:flex; gap:0.4rem;">
              <button class="btn-copy" style="padding:0.25rem 0.6rem; font-size:0.75rem;" onclick="toggleAll(true)">Select All</button>
              <button class="btn-copy" style="padding:0.25rem 0.6rem; font-size:0.75rem;" onclick="toggleAll(false)">Deselect All</button>
            </div>
          </div>

          <div class="catalog-group-title">
            <span>Trakt Rows</span>
            <span style="font-size:0.7rem; color:var(--text-dim);">8 Rows Available</span>
          </div>
          <div class="cat-list" id="traktCatList"></div>

          <div id="simklGroupHeader" class="catalog-group-title" style="margin-top:1.25rem; display:none;">
            <span>Simkl Rows</span>
            <span style="font-size:0.7rem; color:var(--text-dim);">4 Rows Available</span>
          </div>
          <div class="cat-list" id="simklCatList" style="display:none;"></div>
        </div>

        <!-- Live Sync Tab -->
        <div id="tabContentSync" style="display:none;">
          <div class="sync-row">
            <div class="sync-meta">
              <h4>Real-time Movie Scrobbling</h4>
              <p>Syncs movie watch progress automatically upon starting playback.</p>
            </div>
            <span style="color:#10b981; font-weight:700; font-size:0.85rem;">Active</span>
          </div>
          <div class="sync-row">
            <div class="sync-meta">
              <h4>Real-time TV Series Scrobbling</h4>
              <p>Syncs exact season and episode progress to Trakt and Simkl.</p>
            </div>
            <span style="color:#10b981; font-weight:700; font-size:0.85rem;">Active</span>
          </div>
          <div class="sync-row">
            <div class="sync-meta">
              <h4>15-Minute Scrobble Debounce</h4>
              <p>Prevents redundant history updates during scrubbing or restarts.</p>
            </div>
            <span style="color:#38bdf8; font-weight:700; font-size:0.85rem;">Protected</span>
          </div>
        </div>

      </div>

      <!-- 3. Install Addon Deck -->
      <div class="install-box" id="installDeck" style="display:none;">
        <h3 style="font-size:1.15rem; font-weight:800; color:#fff; margin-bottom:0.35rem;">Install Addon</h3>
        <p style="font-size:0.85rem; color:#cbd5e1; margin-bottom:1rem;">Your multi-tracker manifest is ready to install into Stremio & Nuvio.</p>
        
        <a id="stremioInstallBtn" class="btn-install-primary" href="#">
          🚀 Install in Stremio (1-Click)
        </a>

        <div class="manifest-box" id="manifestUrlDisplay"></div>
        <button class="btn-copy" id="btnCopyManifest" onclick="copyManifestUrl()">📋 Copy Manifest URL (for Nuvio / Web)</button>
      </div>

    </div>

  </div>

  <div id="toast">Settings Saved</div>

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
      document.getElementById('mainDashboard').style.display = 'none';
      document.getElementById('lockCard').style.display = 'block';
      return false;
    }

    function unlockDashboard() {
      const val = document.getElementById('passInput').value.trim();
      if (val === SERVER_ACCESS_PASSWORD) {
        currentPassword = val;
        sessionStorage.setItem('addon_pass', val);
        localStorage.setItem('addon_pass', val);
        document.getElementById('lockCard').style.display = 'none';
        document.getElementById('mainDashboard').style.display = 'flex';
        showToast('Instance Unlocked');
        updateUrls();
      } else {
        alert('Invalid access password');
      }
    }

    function showTab(tabId) {
      document.getElementById('tabNavCatalogs').classList.toggle('active', tabId === 'catalogs');
      document.getElementById('tabNavSync').classList.toggle('active', tabId === 'sync');
      document.getElementById('tabContentCatalogs').style.display = tabId === 'catalogs' ? 'block' : 'none';
      document.getElementById('tabContentSync').style.display = tabId === 'sync' ? 'block' : 'none';
    }

    function renderCatalogs() {
      const traktContainer = document.getElementById('traktCatList');
      const simklContainer = document.getElementById('simklCatList');
      const simklHeader = document.getElementById('simklGroupHeader');

      traktContainer.innerHTML = '';
      simklContainer.innerHTML = '';

      const isSimklActive = !!simklToken;
      simklHeader.style.display = isSimklActive ? 'flex' : 'none';
      simklContainer.style.display = isSimklActive ? 'flex' : 'none';

      CATALOG_DEFINITIONS.forEach(cat => {
        const isChecked = selectedCatalogs === null ? true : selectedCatalogs.includes(cat.id);
        const item = document.createElement('div');
        item.className = 'cat-item';

        const left = document.createElement('div');
        left.className = 'cat-left';

        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.id = 'chk-' + cat.id;
        chk.checked = isChecked;
        chk.onchange = (e) => {
          e.stopPropagation();
          onCatalogToggle(cat.id, chk.checked);
        };

        const title = document.createElement('span');
        title.className = 'cat-title';
        title.innerText = cat.title;

        left.appendChild(chk);
        left.appendChild(title);

        const type = document.createElement('span');
        type.className = 'cat-type';
        type.innerText = cat.type;

        item.appendChild(left);
        item.appendChild(type);

        item.onclick = (e) => {
          if (e.target !== chk) {
            chk.checked = !chk.checked;
            onCatalogToggle(cat.id, chk.checked);
          }
        };

        if (cat.group === 'trakt') traktContainer.appendChild(item);
        else if (cat.group === 'simkl') simklContainer.appendChild(item);
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

    function toggleAll(select) {
      if (select) selectedCatalogs = CATALOG_DEFINITIONS.map(c => c.id);
      else selectedCatalogs = [];
      CATALOG_DEFINITIONS.forEach(c => {
        const chk = document.getElementById('chk-' + c.id);
        if (chk) chk.checked = select;
      });
      localStorage.setItem('selected_catalogs', JSON.stringify(selectedCatalogs));
      updateUrls();
      showToast(select ? 'All Catalogs Enabled' : 'All Catalogs Disabled');
    }

    function showToast(msg) {
      const t = document.getElementById('toast');
      t.innerText = msg;
      t.style.display = 'block';
      setTimeout(() => { t.style.display = 'none'; }, 2000);
    }

    async function startTrakt() {
      const btn = document.getElementById('btnStartTrakt');
      btn.innerText = 'Requesting...';
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
        document.getElementById('traktActionInitial').style.display = 'none';
        document.getElementById('traktCodeBox').style.display = 'block';

        pollTraktToken(data.device_code, data.interval || 6, clientId);
      } catch (e) {
        alert(e.message);
        btn.disabled = false;
        btn.innerText = 'Connect Trakt';
      }
    }

    function copyTraktCode() {
      const code = document.getElementById('traktUserCode').innerText;
      navigator.clipboard.writeText(code);
      showToast('Copied: ' + code);
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

            renderTrackersState();
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
      renderTrackersState();
      updateUrls();
      showToast('Trakt Disconnected');
    }

    async function startSimkl() {
      const btn = document.getElementById('btnStartSimkl');
      btn.innerText = 'Requesting...';
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
        document.getElementById('simklActionInitial').style.display = 'none';
        document.getElementById('simklCodeBox').style.display = 'block';

        pollSimklToken(data.device_code, data.interval || 5, clientId);
      } catch (e) {
        alert(e.message);
        btn.disabled = false;
        btn.innerText = 'Connect Simkl';
      }
    }

    function copySimklCode() {
      const code = document.getElementById('simklUserCode').innerText;
      navigator.clipboard.writeText(code);
      showToast('Copied: ' + code);
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
            renderTrackersState();
            renderCatalogs();
            updateUrls();
            showToast('Simkl Connected!');
          }
        } catch (_) {}
      }, (interval || 5) * 1000);
    }

    function disconnectSimkl() {
      simklToken = '';
      localStorage.removeItem('simkl_token');
      renderTrackersState();
      renderCatalogs();
      updateUrls();
      showToast('Simkl Disconnected');
    }

    function renderTrackersState() {
      // Trakt UI
      const traktCard = document.getElementById('traktCard');
      const traktPill = document.getElementById('traktStatusPill');
      const traktUserBox = document.getElementById('traktUserInfo');
      const traktInit = document.getElementById('traktActionInitial');
      const traktCode = document.getElementById('traktCodeBox');
      const traktConn = document.getElementById('traktActionConnected');

      if (traktToken) {
        traktCard.classList.add('active');
        traktPill.className = 'status-pill connected';
        traktPill.innerHTML = '<span class="pulse-dot"></span> Connected';
        traktUserBox.style.display = 'block';
        document.getElementById('traktUsername').innerText = traktUser ? '@' + traktUser : 'Active';
        traktInit.style.display = 'none';
        traktCode.style.display = 'none';
        traktConn.style.display = 'block';
      } else {
        traktCard.classList.remove('active');
        traktPill.className = 'status-pill disconnected';
        traktPill.innerText = 'Not Connected';
        traktUserBox.style.display = 'none';
        traktInit.style.display = 'block';
        traktCode.style.display = 'none';
        traktConn.style.display = 'none';
      }

      // Simkl UI
      const simklCard = document.getElementById('simklCard');
      const simklPill = document.getElementById('simklStatusPill');
      const simklUserBox = document.getElementById('simklUserInfo');
      const simklInit = document.getElementById('simklActionInitial');
      const simklCode = document.getElementById('simklCodeBox');
      const simklConn = document.getElementById('simklActionConnected');

      if (simklToken) {
        simklCard.classList.add('active');
        simklPill.className = 'status-pill connected';
        simklPill.innerHTML = '<span class="pulse-dot"></span> Connected';
        simklUserBox.style.display = 'block';
        simklInit.style.display = 'none';
        simklCode.style.display = 'none';
        simklConn.style.display = 'block';
      } else {
        simklCard.classList.remove('active');
        simklPill.className = 'status-pill disconnected';
        simklPill.innerText = 'Optional';
        simklUserBox.style.display = 'none';
        simklInit.style.display = 'block';
        simklCode.style.display = 'none';
        simklConn.style.display = 'none';
      }
    }

    function copyManifestUrl() {
      const url = document.getElementById('manifestUrlDisplay').innerText;
      navigator.clipboard.writeText(url);
      const btn = document.getElementById('btnCopyManifest');
      btn.innerText = '✓ Copied to Clipboard!';
      setTimeout(() => { btn.innerText = '📋 Copy Manifest URL (for Nuvio / Web)'; }, 2000);
    }

    function updateUrls() {
      const isConnected = !!traktToken || !!simklToken;
      document.getElementById('installDeck').style.display = isConnected ? 'block' : 'none';
      if (!isConnected) return;

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

      document.getElementById('manifestUrlDisplay').innerText = manifest;
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

      renderTrackersState();
      renderCatalogs();
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
