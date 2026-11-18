// Cloudflare Worker: Syncribullet Trakt & Multi-Tracker Addon
// Polished Stremio & Nuvio Addon with Rich Watchlists, Continue Watching, and Auto-Scrobble.

const DEFAULT_TRAKT_CLIENT_ID = '';
const TRAKT_API_URL = 'https://api.trakt.tv';
const SIMKL_API_URL = 'https://api.simkl.com';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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
  const catalogs = [...BASE_CATALOGS];
  if (config && config.simklToken) {
    catalogs.push(...SIMKL_CATALOGS);
  }
  return {
    id: 'org.syncribullet.multisync',
    version: '2.3.0',
    name: 'Trakt Multi-Device Sync',
    description: 'Syncs Trakt and Simkl Watchlists, Continue Watching, and History to Stremio and Nuvio across all devices without account logouts.',
    logo: 'https://raw.githubusercontent.com/nepalanurag/stremio-trakt-sync/main/icon.svg',
    background: 'https://images.metahub.space/background/medium/tt0903747/img',
    resources: ['catalog', 'subtitles'],
    types: ['movie', 'series'],
    catalogs
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

      const url = new URL(request.url);
      const pathname = url.pathname;

      // Web Dashboard
      if (pathname === '/' || pathname === '/configure') {
        const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Stremio Trakt Multi-Device Sync</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0f19; color: #f1f5f9; margin: 0; padding: 1.5rem; display: flex; justify-content: center; }
    .card { background: #161e2e; border-radius: 16px; padding: 2rem; max-width: 580px; width: 100%; box-shadow: 0 10px 35px rgba(0,0,0,0.6); border: 1px solid #1e293b; }
    h1 { font-size: 1.5rem; color: #38bdf8; margin: 0 0 0.5rem 0; }
    p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; margin: 0 0 1.5rem 0; }
    .section { background: #0f172a; border-radius: 12px; padding: 1.25rem; margin-bottom: 1.25rem; border: 1px solid #1e293b; }
    .section-title { font-size: 0.95rem; font-weight: 700; color: #e2e8f0; margin-bottom: 0.75rem; display: flex; align-items: center; justify-content: space-between; }
    .btn { background: #0284c7; color: white; border: none; border-radius: 8px; padding: 0.85rem 1.25rem; font-weight: 600; font-size: 1rem; cursor: pointer; width: 100%; transition: background 0.15s ease-in-out; text-align: center; text-decoration: none; display: block; }
    .btn:hover { background: #0369a1; }
    .btn-green { background: #10b981; }
    .btn-green:hover { background: #059669; }
    .btn-outline { background: transparent; border: 1px solid #38bdf8; color: #38bdf8; font-size: 0.9rem; padding: 0.6rem; margin-top: 0.5rem; }
    .btn-outline:hover { background: rgba(56,189,248,0.1); }
    .code-box { background: #020617; border: 1px dashed #38bdf8; border-radius: 8px; padding: 1.25rem; margin-top: 1rem; text-align: center; }
    .user-code { font-size: 2.2rem; font-weight: 800; letter-spacing: 6px; color: #38bdf8; margin: 0.5rem 0; font-family: monospace; }
    .status-text { font-size: 0.85rem; color: #94a3b8; margin: 0.5rem 0 0 0; }
    .badge-success { background: rgba(16,185,129,0.15); border: 1px solid #10b981; color: #34d399; padding: 0.75rem; border-radius: 8px; font-weight: 600; text-align: center; margin-top: 1rem; }
    .url-display { background: #020617; word-break: break-all; padding: 0.75rem; border-radius: 6px; font-family: monospace; font-size: 0.8rem; color: #a5f3fc; margin-top: 0.5rem; border: 1px solid #1e293b; user-select: all; }
    input { width: 100%; padding: 0.75rem; border: 1px solid #334155; border-radius: 6px; background: #020617; color: #fff; box-sizing: border-box; font-size: 0.9rem; margin-top: 0.4rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Trakt Multi-Device Sync</h1>
    <p>Connect Trakt once. Sync playback and catalogs across 5+ Stremio and Nuvio devices without ever getting logged out.</p>

    <!-- Trakt Section -->
    <div class="section">
      <div class="section-title">
        <span>1. Trakt Account</span>
        <span id="traktBadge" style="font-size:0.8rem; color:#94a3b8;">Not Connected</span>
      </div>

      <div id="traktInitial">
        <button id="btnTrakt" class="btn" onclick="startTrakt()">Tap to Connect Trakt</button>
      </div>

      <div id="traktCodeBox" class="code-box" style="display:none;">
        <p style="margin:0 0 0.25rem 0; font-size:0.85rem; color:#cbd5e1;">Your activation code:</p>
        <div id="traktUserCode" class="user-code">----</div>
        <a id="traktActivateLink" class="btn btn-outline" href="https://auth.trakt.tv/activate" target="_blank">1. Open Trakt Activate in New Tab</a>
        <button class="btn btn-outline" style="border-color:#64748b; color:#cbd5e1; margin-top:0.4rem;" onclick="copyCode()">2. Copy Code to Clipboard</button>
        <p id="traktPollStatus" class="status-text">Waiting for you to tap Yes on Trakt...</p>
      </div>

      <div id="traktConnected" class="badge-success" style="display:none;">
        Connected to Trakt: <span id="traktUser" style="color:#fff;"></span>
      </div>
    </div>

    <!-- Simkl Section -->
    <div class="section">
      <div class="section-title">
        <span>2. Simkl (Optional)</span>
        <span id="simklBadge" style="font-size:0.8rem; color:#94a3b8;">Optional</span>
      </div>
      <p style="font-size:0.85rem; margin:0 0 0.5rem 0;">Cross-syncs playback and watchlists with Simkl.</p>
      <div id="simklBtnWrap">
        <button id="btnSimkl" class="btn btn-outline" style="border-color:#38bdf8; color:#38bdf8;" onclick="startSimkl()">Tap to Connect Simkl</button>
      </div>

      <div id="simklCodeBox" class="code-box" style="display:none;">
        <p style="margin:0 0 0.25rem 0; font-size:0.85rem; color:#cbd5e1;">Your Simkl PIN code:</p>
        <div id="simklUserCode" class="user-code">----</div>
        <a id="simklActivateLink" class="btn btn-outline" href="https://simkl.com/pin" target="_blank">1. Open simkl.com/pin in New Tab</a>
        <button class="btn btn-outline" style="border-color:#64748b; color:#cbd5e1; margin-top:0.4rem;" onclick="copySimklCode()">2. Copy Code to Clipboard</button>
        <p id="simklPollStatus" class="status-text">Waiting for authorization on Simkl...</p>
      </div>

      <div id="simklConnected" class="badge-success" style="display:none;">
        Connected to Simkl
      </div>

      <div style="margin-top:0.75rem;">
        <p style="font-size:0.75rem; color:#64748b; margin:0;">Or paste token directly:</p>
        <input id="simklToken" placeholder="Paste existing Simkl Token" oninput="updateUrls()">
      </div>
    </div>

    <!-- Install -->
    <div id="installSection" style="display:none; margin-top:1.5rem;">
      <a id="stremioLink" class="btn btn-green" href="#">🚀 Install in Stremio (1-Click)</a>
      <p style="margin:1.25rem 0 0.25rem 0; font-size:0.85rem; font-weight:600; color:#cbd5e1;">Or copy Manifest URL into Nuvio / Stremio Web:</p>
      <div id="manifestUrl" class="url-display"></div>
    </div>
  </div>

  <script>
    const SERVER_TRAKT_CLIENT_ID = "${traktClientId}";
    const SERVER_SIMKL_CLIENT_ID = "${simklClientId}";

    let traktToken = '';
    let activeTraktClientId = SERVER_TRAKT_CLIENT_ID;
    let simklToken = '';
    let activeSimklClientId = SERVER_SIMKL_CLIENT_ID;
    let pollInterval = null;
    let simklPollInterval = null;

    async function startTrakt() {
      const btn = document.getElementById('btnTrakt');
      btn.disabled = true;
      btn.innerText = 'Requesting code...';

      const clientId = activeTraktClientId || SERVER_TRAKT_CLIENT_ID;
      if (!clientId) {
        alert('TRAKT_CLIENT_ID is not configured in Cloudflare Environment Variables.');
        btn.disabled = false;
        btn.innerText = 'Tap to Connect Trakt';
        return;
      }

      try {
        let data = null;

        // Method 1: Direct browser fetch to Trakt API (bypasses Cloudflare Worker egress IP rate limits)
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
          if (directRes.ok) {
            data = await directRes.json();
          }
        } catch (e) {
          console.warn('Direct Trakt connection failed, attempting worker proxy fallback:', e);
        }

        // Method 2: Worker Proxy fallback
        if (!data) {
          const res = await fetch('/api/auth/start', { method: 'POST' });
          const text = await res.text();
          try {
            data = JSON.parse(text);
          } catch (_) {
            throw new Error('Server returned non-JSON response: ' + text.slice(0, 150));
          }
          if (!res.ok) throw new Error(data.error || 'Failed to request Trakt code');
        }

        if (!data || !data.user_code) {
          throw new Error('Failed to acquire Trakt activation code');
        }

        document.getElementById('traktUserCode').innerText = data.user_code;
        document.getElementById('traktActivateLink').href = data.verification_url || 'https://auth.trakt.tv/activate';
        document.getElementById('traktInitial').style.display = 'none';
        document.getElementById('traktCodeBox').style.display = 'block';

        pollTraktToken(data.device_code, data.interval || 6, clientId);
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
        btn.innerText = 'Tap to Connect Trakt';
      }
    }

    function copyCode() {
      const code = document.getElementById('traktUserCode').innerText;
      navigator.clipboard.writeText(code);
      alert('Code ' + code + ' copied to clipboard!');
    }

    function pollTraktToken(deviceCode, interval, clientId) {
      if (pollInterval) clearInterval(pollInterval);
      pollInterval = setInterval(async () => {
        try {
          let tokenData = null;

          // Method 1: Direct browser polling
          try {
            const directRes = await fetch('https://api.trakt.tv/oauth/device/token', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'trakt-api-version': '2',
                'trakt-api-key': clientId
              },
              body: JSON.stringify({
                code: deviceCode,
                client_id: clientId
              })
            });
            if (directRes.ok) {
              tokenData = await directRes.json();
            }
          } catch (_) {}

          // Method 2: Worker proxy polling fallback
          if (!tokenData) {
            const res = await fetch('/api/auth/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ deviceCode })
            });
            if (res.ok) {
              const resData = await res.json();
              if (resData.access_token) tokenData = resData;
            }
          }

          if (tokenData && tokenData.access_token) {
            clearInterval(pollInterval);
            traktToken = tokenData.access_token;
            activeTraktClientId = clientId;

            // Fetch Trakt username directly
            let username = '';
            try {
              const uRes = await fetch('https://api.trakt.tv/users/me', {
                headers: {
                  'Content-Type': 'application/json',
                  'trakt-api-version': '2',
                  'trakt-api-key': clientId,
                  'Authorization': 'Bearer ' + traktToken
                }
              });
              if (uRes.ok) {
                const uData = await uRes.json();
                username = uData.username || '';
              }
            } catch (_) {}

            document.getElementById('traktCodeBox').style.display = 'none';
            document.getElementById('traktBadge').innerText = 'Connected';
            document.getElementById('traktBadge').style.color = '#34d399';
            document.getElementById('traktUser').innerText = username ? '@' + username : 'Active';
            document.getElementById('traktConnected').style.display = 'block';
            document.getElementById('installSection').style.display = 'block';

            updateUrls();
          }
        } catch (_) {}
      }, (interval || 6) * 1000);
    }

    async function startSimkl() {
      const btn = document.getElementById('btnSimkl');
      btn.disabled = true;
      btn.innerText = 'Requesting Simkl PIN...';

      const clientId = activeSimklClientId || SERVER_SIMKL_CLIENT_ID;

      try {
        let data = null;

        // Method 1: Direct browser fetch to Simkl
        if (clientId) {
          try {
            const directRes = await fetch('https://api.simkl.com/oauth/pin?client_id=' + encodeURIComponent(clientId));
            if (directRes.ok) {
              data = await directRes.json();
            }
          } catch (_) {}
        }

        // Method 2: Worker proxy fallback
        if (!data) {
          const res = await fetch('/api/simkl/start', { method: 'POST' });
          const text = await res.text();
          try {
            data = JSON.parse(text);
          } catch (_) {
            throw new Error('Server returned non-JSON response: ' + text.slice(0, 150));
          }
          if (!res.ok) {
            alert(data.error || 'Set SIMKL_CLIENT_ID in Cloudflare or paste token below');
            btn.disabled = false;
            btn.innerText = 'Tap to Connect Simkl';
            return;
          }
        }

        if (!data || !data.user_code) {
          throw new Error('Failed to acquire Simkl PIN');
        }

        document.getElementById('simklUserCode').innerText = data.user_code;
        document.getElementById('simklBtnWrap').style.display = 'none';
        document.getElementById('simklCodeBox').style.display = 'block';

        pollSimklToken(data.user_code || data.device_code, data.interval || 5, clientId);
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
        btn.innerText = 'Tap to Connect Simkl';
      }
    }

    function copySimklCode() {
      const code = document.getElementById('simklUserCode').innerText;
      navigator.clipboard.writeText(code);
      alert('Code ' + code + ' copied to clipboard!');
    }

    function pollSimklToken(userCodeOrDeviceCode, interval, clientId) {
      if (simklPollInterval) clearInterval(simklPollInterval);
      simklPollInterval = setInterval(async () => {
        try {
          let token = null;

          // Method 1: Direct Simkl polling
          if (clientId && userCodeOrDeviceCode) {
            try {
              const directRes = await fetch('https://api.simkl.com/oauth/pin/check/' + encodeURIComponent(userCodeOrDeviceCode) + '?client_id=' + encodeURIComponent(clientId));
              if (directRes.ok) {
                const directData = await directRes.json();
                if (directData.result === 'OK' && directData.access_token) {
                  token = directData.access_token;
                }
              }
            } catch (_) {}
          }

          // Method 2: Worker proxy fallback
          if (!token) {
            const res = await fetch('/api/simkl/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ deviceCode: userCodeOrDeviceCode })
            });
            if (res.ok) {
              const resData = await res.json();
              if (resData.access_token) token = resData.access_token;
            }
          }

          if (token) {
            clearInterval(simklPollInterval);
            simklToken = token;
            document.getElementById('simklToken').value = simklToken;
            document.getElementById('simklCodeBox').style.display = 'none';
            document.getElementById('simklBadge').innerText = 'Connected';
            document.getElementById('simklBadge').style.color = '#34d399';
            document.getElementById('simklConnected').style.display = 'block';
            updateUrls();
          }
        } catch (_) {}
      }, (interval || 5) * 1000);
    }

    function updateUrls() {
      if (!traktToken) return;
      const simkl = document.getElementById('simklToken').value.trim();
      const configObj = {
        traktToken: traktToken,
        traktClientId: activeTraktClientId || SERVER_TRAKT_CLIENT_ID || undefined,
        simklToken: simkl || undefined,
        simklClientId: activeSimklClientId || SERVER_SIMKL_CLIENT_ID || undefined
      };

      const enc = btoa(JSON.stringify(configObj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const origin = window.location.origin;
      const manifest = origin + '/' + enc + '/manifest.json';
      const stremio = manifest.replace(/^https?:\/\//, 'stremio://');

      document.getElementById('manifestUrl').innerText = manifest;
      document.getElementById('stremioLink').href = stremio;
    }
  </script>
</body>
</html>`;
        return new Response(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

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
        if (!simklClientId) {
          return jsonResponse({ error: 'SIMKL_CLIENT_ID not configured in Cloudflare environment variables' }, 400);
        }
        try {
          const res = await fetch(`${SIMKL_API_URL}/oauth2/device`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'User-Agent': USER_AGENT
            },
            body: JSON.stringify({ client_id: simklClientId })
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
        if (!simklClientId) {
          return jsonResponse({ error: 'SIMKL_CLIENT_ID not configured' }, 400);
        }
        const { deviceCode } = await request.json();
        try {
          const res = await fetch(`${SIMKL_API_URL}/oauth2/token`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'User-Agent': USER_AGENT
            },
            body: JSON.stringify({
              client_id: simklClientId,
              code: deviceCode,
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

        return jsonResponse({ subtitles: [] });
      }

      // Catalogs
      if (routeParts[0] === 'catalog' && routeParts.length >= 3) {
        const type = routeParts[1];
        const idWithExt = routeParts[2];
        const catalogId = idWithExt.replace(/\.json$/, '');
        const extraSegment = routeParts[3] ? routeParts[3].replace(/\.json$/, '') : '';

        if (!config) return jsonResponse({ metas: [] });
        const metas = await handleCatalog(catalogId, type, extraSegment, config, traktClientId, simklClientId);
        return jsonResponse({ metas });
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
