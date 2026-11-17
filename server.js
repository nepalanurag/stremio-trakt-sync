import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 7070;
const TRAKT_API_URL = 'https://api.trakt.tv';
const SIMKL_API_URL = 'https://api.simkl.com';
const CONFIG_FILE = path.join(__dirname, 'config.json');

// In-memory or file-backed configuration fallback
let savedConfig = {};
try {
  if (fs.existsSync(CONFIG_FILE)) {
    savedConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  }
} catch (e) {
  console.error('Could not load config.json:', e.message);
}

// In-memory debounce cache to avoid duplicate sync calls during player seeks
const syncDebounceCache = new Map();
function shouldSync(key) {
  const now = Date.now();
  const last = syncDebounceCache.get(key) || 0;
  if (now - last < 15 * 60 * 1000) { // 15-minute debounce per media item
    return false;
  }
  syncDebounceCache.set(key, now);
  if (syncDebounceCache.size > 2000) {
    for (const [k, v] of syncDebounceCache.entries()) {
      if (now - v > 30 * 60 * 1000) syncDebounceCache.delete(k);
    }
  }
  return true;
}

const MANIFEST_TEMPLATE = {
  id: 'org.syncribullet.multisync',
  version: '2.0.0',
  name: 'Syncribullet Trakt & Multi-Tracker',
  description: 'Syncribullet-style sync across unlimited devices: automatically scrobbles playback to Trakt & Simkl via the subtitle hook, and syncs catalogs.',
  resources: ['catalog', 'subtitles'],
  types: ['movie', 'series'],
  catalogs: [
    {
      type: 'movie',
      id: 'trakt_playback_movies',
      name: 'Trakt: Continue Watching',
      extra: [{ name: 'skip', isRequired: false }]
    },
    {
      type: 'series',
      id: 'trakt_playback_series',
      name: 'Trakt: Continue Watching',
      extra: [{ name: 'skip', isRequired: false }]
    },
    {
      type: 'movie',
      id: 'trakt_watchlist_movies',
      name: 'Trakt: Watchlist',
      extra: [{ name: 'skip', isRequired: false }]
    },
    {
      type: 'series',
      id: 'trakt_watchlist_series',
      name: 'Trakt: Watchlist',
      extra: [{ name: 'skip', isRequired: false }]
    },
    {
      type: 'movie',
      id: 'trakt_history_movies',
      name: 'Trakt: History',
      extra: [{ name: 'skip', isRequired: false }]
    },
    {
      type: 'series',
      id: 'trakt_history_series',
      name: 'Trakt: History',
      extra: [{ name: 'skip', isRequired: false }]
    }
  ]
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*'
  });
  res.end(JSON.stringify(data));
}

function sendHtml(res, html) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(html);
}

function parseConfigFromSegment(segment) {
  if (!segment) return null;
  try {
    const raw = Buffer.from(segment, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (parsed.traktToken || parsed.token || parsed.simklToken) return parsed;
  } catch (_) {}
  try {
    const raw = Buffer.from(segment, 'base64').toString('utf8');
    const parsed = JSON.parse(raw);
    if (parsed.traktToken || parsed.token || parsed.simklToken) return parsed;
  } catch (_) {}
  return null;
}

function parseMediaId(type, idWithExt) {
  const rawId = idWithExt.replace(/\.json$/, '');
  if (type === 'movie') {
    return { type: 'movie', imdbId: rawId };
  }
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

async function fetchTrakt(endpoint, token, clientId, method = 'GET', body = null) {
  const url = `${TRAKT_API_URL}${endpoint}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'trakt-api-version': '2',
      'trakt-api-key': clientId,
      'Authorization': `Bearer ${token}`
    }
  };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(url, options);
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Trakt API error: ${response.status} ${response.statusText} (${errText})`);
  }
  return response.json();
}

async function fetchSimkl(endpoint, token, clientId, method = 'GET', body = null) {
  const url = `${SIMKL_API_URL}${endpoint}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'simkl-api-key': clientId,
      'Authorization': `Bearer ${token}`
    }
  };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(url, options);
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Simkl API error: ${response.status} ${response.statusText} (${errText})`);
  }
  return response.json();
}

// Syncribullet Subtitle Scrobble Hook: Dynamic sync to Trakt & Simkl on playback
async function performDynamicWatchSync(media, config) {
  const traktToken = config.traktToken || config.token;
  const traktClientId = config.traktClientId || config.clientId;
  const simklToken = config.simklToken;
  const simklClientId = config.simklClientId;

  // 1. Sync to Trakt
  if (traktToken && traktClientId && media.imdbId.startsWith('tt')) {
    try {
      let traktPayload = {};
      if (media.type === 'movie') {
        traktPayload = {
          movies: [{ ids: { imdb: media.imdbId } }]
        };
      } else if (media.season !== undefined && media.episode !== undefined) {
        traktPayload = {
          shows: [{
            ids: { imdb: media.imdbId },
            seasons: [{
              number: media.season,
              episodes: [{ number: media.episode }]
            }]
          }]
        };
      }
      if (Object.keys(traktPayload).length > 0) {
        await fetchTrakt('/sync/history', traktToken, traktClientId, 'POST', traktPayload);
        console.log(`[Dynamic Sync] Recorded watch on Trakt: ${media.imdbId} (${media.type === 'series' ? `S${media.season}E${media.episode}` : 'movie'})`);
      }
    } catch (err) {
      console.error('[Dynamic Sync Error - Trakt]:', err.message);
    }
  }

  // 2. Sync to Simkl (optional)
  if (simklToken && simklClientId && media.imdbId.startsWith('tt')) {
    try {
      let simklPayload = {};
      if (media.type === 'movie') {
        simklPayload = {
          movies: [{ ids: { imdb: media.imdbId } }]
        };
      } else if (media.season !== undefined && media.episode !== undefined) {
        simklPayload = {
          shows: [{
            ids: { imdb: media.imdbId },
            seasons: [{
              number: media.season,
              episodes: [{ number: media.episode }]
            }]
          }]
        };
      }
      if (Object.keys(simklPayload).length > 0) {
        await fetchSimkl('/sync/history', simklToken, simklClientId, 'POST', simklPayload);
        console.log(`[Dynamic Sync] Recorded watch on Simkl: ${media.imdbId}`);
      }
    } catch (err) {
      console.error('[Dynamic Sync Error - Simkl]:', err.message);
    }
  }
}

function mapToMeta(item, type) {
  const target = item.movie || item.show;
  if (!target || !target.ids) return null;

  const imdbId = target.ids.imdb;
  const traktId = target.ids.trakt;
  const id = imdbId || `trakt:${traktId}`;
  const title = target.title || 'Unknown Title';
  const year = target.year ? String(target.year) : undefined;
  const poster = imdbId ? `https://images.metahub.space/poster/medium/${imdbId}/img` : undefined;

  return {
    id,
    type,
    name: title,
    poster,
    year,
    description: target.overview || ''
  };
}

async function handleCatalog(catalogId, type, skip, config) {
  const token = config.traktToken || config.token;
  const clientId = config.traktClientId || config.clientId;
  if (!token || !clientId) return [];

  const page = Math.floor(skip / 20) + 1;
  const limit = 20;
  let items = [];

  if (catalogId === 'trakt_playback_movies' && type === 'movie') {
    const data = await fetchTrakt(`/sync/playback/movies?extended=full`, token, clientId);
    items = data.map(i => mapToMeta(i, 'movie')).filter(Boolean);
  } else if (catalogId === 'trakt_playback_series' && type === 'series') {
    const data = await fetchTrakt(`/sync/playback/episodes?extended=full`, token, clientId);
    const seenShows = new Set();
    items = [];
    for (const item of data) {
      if (item.show && item.show.ids && !seenShows.has(item.show.ids.trakt)) {
        seenShows.add(item.show.ids.trakt);
        const meta = mapToMeta(item, 'series');
        if (meta) items.push(meta);
      }
    }
  } else if (catalogId === 'trakt_watchlist_movies' && type === 'movie') {
    const data = await fetchTrakt(`/sync/watchlist/movies?extended=full&page=${page}&limit=${limit}`, token, clientId);
    items = data.map(i => mapToMeta(i, 'movie')).filter(Boolean);
  } else if (catalogId === 'trakt_watchlist_series' && type === 'series') {
    const data = await fetchTrakt(`/sync/watchlist/shows?extended=full&page=${page}&limit=${limit}`, token, clientId);
    items = data.map(i => mapToMeta(i, 'series')).filter(Boolean);
  } else if (catalogId === 'trakt_history_movies' && type === 'movie') {
    const data = await fetchTrakt(`/sync/history/movies?extended=full&page=${page}&limit=${limit}`, token, clientId);
    items = data.map(i => mapToMeta(i, 'movie')).filter(Boolean);
  } else if (catalogId === 'trakt_history_series' && type === 'series') {
    const data = await fetchTrakt(`/sync/history/shows?extended=full&page=${page}&limit=${limit}`, token, clientId);
    items = data.map(i => mapToMeta(i, 'series')).filter(Boolean);
  }

  return items;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*'
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // Web UI Setup Dashboard
  if (pathname === '/' || pathname === '/configure') {
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Syncribullet Trakt & Multi-Tracker</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0f19; color: #f1f5f9; margin: 0; padding: 2rem; display: flex; justify-content: center; }
    .card { background: #161e2e; border-radius: 14px; padding: 2rem; max-width: 620px; width: 100%; box-shadow: 0 10px 30px rgba(0,0,0,0.6); border: 1px solid #1e293b; }
    h1 { font-size: 1.5rem; margin-top: 0; color: #38bdf8; }
    p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; }
    .badge { display: inline-block; background: #0369a1; color: #e0f2fe; padding: 0.2rem 0.6rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; margin-bottom: 1rem; }
    label { display: block; margin-top: 1.25rem; font-weight: 600; font-size: 0.85rem; color: #cbd5e1; }
    input { width: 100%; padding: 0.75rem; margin-top: 0.25rem; border: 1px solid #334155; border-radius: 6px; background: #0b0f19; color: #fff; box-sizing: border-box; }
    button { background: #0284c7; color: white; border: none; border-radius: 6px; padding: 0.75rem 1.25rem; font-weight: 600; margin-top: 1.25rem; cursor: pointer; width: 100%; transition: background 0.2s; }
    button:hover { background: #0369a1; }
    .code-box { background: #0b0f19; border: 1px dashed #38bdf8; border-radius: 8px; padding: 1.25rem; margin-top: 1rem; text-align: center; }
    .user-code { font-size: 2rem; font-weight: bold; letter-spacing: 5px; color: #38bdf8; margin: 0.5rem 0; }
    .btn-install { background: #10b981; margin-top: 1rem; text-decoration: none; display: block; text-align: center; color: white; padding: 0.85rem; border-radius: 6px; font-weight: 600; font-size: 1rem; }
    .btn-install:hover { background: #059669; }
    .url-display { background: #0b0f19; word-break: break-all; padding: 0.75rem; border-radius: 6px; font-family: monospace; font-size: 0.8rem; color: #a5f3fc; margin-top: 0.5rem; border: 1px solid #1e293b; }
    .hint { font-size: 0.8rem; color: #64748b; margin-top: 0.25rem; }
  </style>
</head>
<body>
  <div class="card">
    <span class="badge">Syncribullet Engine</span>
    <h1>Trakt Multi-Device Sync</h1>
    <p>Uses Syncribullet's automatic subtitle-scrobble hook to sync watch status directly to Trakt across 5+ Stremio and Nuvio devices without hitting Trakt's 1-community-app connection limit.</p>

    <label for="clientId">Trakt Client ID (from trakt.tv/oauth/applications):</label>
    <input id="clientId" placeholder="Paste Client ID">

    <label for="clientSecret">Trakt Client Secret:</label>
    <input id="clientSecret" type="password" placeholder="Paste Client Secret">

    <label for="simklToken">Simkl Access Token (Optional):</label>
    <input id="simklToken" placeholder="Leave blank if using only Trakt">
    <div class="hint">If set, playback will cross-sync to both Trakt and Simkl simultaneously.</div>

    <button id="btnStart" onclick="startAuth()">Connect Trakt Account</button>

    <div id="stepCode" class="code-box" style="display:none;">
      <p style="margin:0;">Open <a id="verifyUrl" href="https://trakt.tv/activate" target="_blank" style="color:#38bdf8; font-weight:bold; text-decoration:underline;">trakt.tv/activate</a> on any phone or browser and enter:</p>
      <div id="userCode" class="user-code">----</div>
      <p id="pollStatus" style="font-size:0.85rem; margin:0; color:#94a3b8;">Waiting for authorization from Trakt...</p>
    </div>

    <div id="stepInstall" style="display:none; margin-top:1.5rem;">
      <a id="stremioLink" class="btn-install" href="#">Install in Stremio (1-Click)</a>
      <p style="margin-top:1.25rem; margin-bottom:0.25rem; font-weight:600;">Or copy Manifest URL into Nuvio / Stremio Web:</p>
      <div id="manifestUrl" class="url-display"></div>
    </div>
  </div>

  <script>
    let pollInterval = null;

    async function startAuth() {
      const clientId = document.getElementById('clientId').value.trim();
      const clientSecret = document.getElementById('clientSecret').value.trim();
      if (!clientId || !clientSecret) return alert('Enter both Trakt Client ID and Client Secret');

      document.getElementById('btnStart').disabled = true;
      document.getElementById('btnStart').innerText = 'Requesting code...';

      try {
        const res = await fetch('/api/auth/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, clientSecret })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to start auth');

        document.getElementById('userCode').innerText = data.user_code;
        document.getElementById('verifyUrl').href = data.verification_url;
        document.getElementById('stepCode').style.display = 'block';
        document.getElementById('btnStart').style.display = 'none';

        pollToken(data.device_code, clientId, clientSecret, data.interval || 5);
      } catch (err) {
        alert(err.message);
        document.getElementById('btnStart').disabled = false;
        document.getElementById('btnStart').innerText = 'Connect Trakt Account';
      }
    }

    function pollToken(deviceCode, clientId, clientSecret, interval) {
      pollInterval = setInterval(async () => {
        try {
          const res = await fetch('/api/auth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceCode, clientId, clientSecret })
          });
          const data = await res.json();
          if (res.ok && data.access_token) {
            clearInterval(pollInterval);
            document.getElementById('stepCode').style.display = 'none';
            document.getElementById('stepInstall').style.display = 'block';

            const simklToken = document.getElementById('simklToken').value.trim();
            const configObj = {
              traktToken: data.access_token,
              traktClientId: clientId,
              simklToken: simklToken || undefined
            };

            const enc = btoa(JSON.stringify(configObj)).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
            const host = window.location.host;
            const protocol = window.location.protocol;
            const manifest = protocol + '//' + host + '/' + enc + '/manifest.json';
            const stremio = 'stremio://' + host + '/' + enc + '/manifest.json';

            document.getElementById('manifestUrl').innerText = manifest;
            document.getElementById('stremioLink').href = stremio;
          }
        } catch (_) {}
      }, interval * 1000);
    }
  </script>
</body>
</html>`;
    return sendHtml(res, html);
  }

  // API: Start Device Code Auth
  if (pathname === '/api/auth/start' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { clientId } = JSON.parse(body || '{}');
        const traktRes = await fetch(`${TRAKT_API_URL}/oauth/device/code`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId })
        });
        const data = await traktRes.json();
        return sendJson(res, traktRes.status, data);
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    });
    return;
  }

  // API: Poll Device Token
  if (pathname === '/api/auth/token' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { deviceCode, clientId, clientSecret } = JSON.parse(body || '{}');
        const traktRes = await fetch(`${TRAKT_API_URL}/oauth/device/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: deviceCode,
            client_id: clientId,
            client_secret: clientSecret
          })
        });
        const data = await traktRes.json();
        if (traktRes.ok && data.access_token) {
          savedConfig = { traktToken: data.access_token, traktClientId: clientId };
          try {
            fs.writeFileSync(CONFIG_FILE, JSON.stringify(savedConfig, null, 2));
          } catch (_) {}
        }
        return sendJson(res, traktRes.status, data);
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    });
    return;
  }

  // Parse Stremio Route
  const parts = pathname.replace(/^\/+|\/+$/g, '').split('/');
  let config = (savedConfig.traktToken || savedConfig.token) ? savedConfig : null;
  let offset = 0;

  const potentialConfig = parseConfigFromSegment(parts[0]);
  if (potentialConfig) {
    config = potentialConfig;
    offset = 1;
  }

  const routeParts = parts.slice(offset);

  // Manifest endpoint
  if (routeParts.length === 1 && routeParts[0] === 'manifest.json') {
    return sendJson(res, 200, MANIFEST_TEMPLATE);
  }

  // Subtitles endpoint (Syncribullet Dynamic Playback Scrobble Hook)
  if (routeParts[0] === 'subtitles' && routeParts.length >= 3) {
    const type = routeParts[1];
    const idWithExt = routeParts[2];
    const media = parseMediaId(type, idWithExt);

    if (config && media.imdbId) {
      const syncKey = `${media.imdbId}:${media.season || 0}:${media.episode || 0}`;
      if (shouldSync(syncKey)) {
        performDynamicWatchSync(media, config).catch(err => {
          console.error('[Background Sync Exception]:', err.message);
        });
      }
    }

    return sendJson(res, 200, { subtitles: [] });
  }

  // Catalog endpoint
  if (routeParts[0] === 'catalog' && routeParts.length >= 3) {
    const type = routeParts[1];
    const idWithExt = routeParts[2];
    const catalogId = idWithExt.replace(/\.json$/, '');
    const extraSegment = routeParts[3] ? routeParts[3].replace(/\.json$/, '') : '';

    let skip = 0;
    if (extraSegment && extraSegment.includes('skip=')) {
      const match = extraSegment.match(/skip=(\d+)/);
      if (match) skip = parseInt(match[1], 10);
    }

    if (!config) {
      return sendJson(res, 200, { metas: [] });
    }

    try {
      const metas = await handleCatalog(catalogId, type, skip, config);
      return sendJson(res, 200, { metas });
    } catch (err) {
      console.error(`Error handling catalog ${catalogId}:`, err.message);
      return sendJson(res, 200, { metas: [] });
    }
  }

  return sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`Syncribullet Trakt Addon running at http://localhost:${PORT}`);
  console.log(`Configure at http://localhost:${PORT}/configure`);
});
