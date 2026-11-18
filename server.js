import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 7070;
const DEFAULT_TRAKT_CLIENT_ID = '';
const TRAKT_CLIENT_ID = process.env.TRAKT_CLIENT_ID || DEFAULT_TRAKT_CLIENT_ID;
const TRAKT_API_URL = 'https://api.trakt.tv';
const SIMKL_API_URL = 'https://api.simkl.com';
const CONFIG_FILE = path.join(__dirname, 'config.json');

let savedConfig = {};
try {
  if (fs.existsSync(CONFIG_FILE)) {
    savedConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  }
} catch (e) {
  console.error('Could not load config.json:', e.message);
}

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

const MANIFEST_TEMPLATE = {
  id: 'org.syncribullet.multisync',
  version: '2.1.0',
  name: 'Trakt & Simkl Multi-Device Sync',
  description: 'Tap-and-setup Trakt scrobbler and catalog sync across unlimited Stremio & Nuvio devices.',
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

async function fetchSimkl(endpoint, token, method = 'GET', body = null) {
  const url = `${SIMKL_API_URL}${endpoint}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
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

async function performDynamicWatchSync(media, config) {
  const traktToken = config.traktToken || config.token;
  const traktClientId = config.traktClientId || config.clientId || TRAKT_CLIENT_ID;
  const simklToken = config.simklToken;

  if (traktToken && traktClientId && media.imdbId.startsWith('tt')) {
    try {
      let traktPayload = {};
      if (media.type === 'movie') {
        traktPayload = { movies: [{ ids: { imdb: media.imdbId } }] };
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
        console.log(`[Dynamic Sync] Marked ${media.imdbId} on Trakt`);
      }
    } catch (err) {
      console.error('[Dynamic Sync Error - Trakt]:', err.message);
    }
  }

  if (simklToken && media.imdbId.startsWith('tt')) {
    try {
      let simklPayload = {};
      if (media.type === 'movie') {
        simklPayload = { movies: [{ ids: { imdb: media.imdbId } }] };
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
        await fetchSimkl('/sync/history', simklToken, 'POST', simklPayload);
        console.log(`[Dynamic Sync] Marked ${media.imdbId} on Simkl`);
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
  const id = imdbId || `trakt:${target.ids.trakt}`;
  return {
    id,
    type,
    name: target.title || 'Unknown Title',
    poster: imdbId ? `https://images.metahub.space/poster/medium/${imdbId}/img` : undefined,
    year: target.year ? String(target.year) : undefined,
    description: target.overview || ''
  };
}

async function handleCatalog(catalogId, type, skip, config) {
  const token = config.traktToken || config.token;
  const clientId = config.traktClientId || config.clientId || TRAKT_CLIENT_ID;
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
      if (item.show?.ids?.trakt && !seenShows.has(item.show.ids.trakt)) {
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
    .btn { background: #0284c7; color: white; border: none; border-radius: 8px; padding: 0.85rem 1.25rem; font-weight: 600; font-size: 1rem; cursor: pointer; width: 100%; text-align: center; text-decoration: none; display: block; }
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

    <div class="section">
      <div class="section-title">
        <span>2. Simkl (Optional)</span>
        <span id="simklBadge" style="font-size:0.8rem; color:#64748b;">Optional</span>
      </div>
      <p style="font-size:0.85rem; margin:0 0 0.5rem 0;">Cross-syncs playback to Simkl at the same time.</p>
      <input id="simklToken" placeholder="Paste Simkl Token (or leave blank for Trakt only)" oninput="updateUrls()">
    </div>

    <div id="installSection" style="display:none; margin-top:1.5rem;">
      <a id="stremioLink" class="btn btn-green" href="#">🚀 Install in Stremio (1-Click)</a>
      <p style="margin:1.25rem 0 0.25rem 0; font-size:0.85rem; font-weight:600; color:#cbd5e1;">Or copy Manifest URL into Nuvio / Stremio Web:</p>
      <div id="manifestUrl" class="url-display"></div>
    </div>
  </div>

  <script>
    let traktToken = '';
    let pollInterval = null;

    async function startTrakt() {
      const btn = document.getElementById('btnTrakt');
      btn.disabled = true;
      btn.innerText = 'Requesting code...';

      try {
        const res = await fetch('/api/auth/start', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to request Trakt code');

        document.getElementById('traktUserCode').innerText = data.user_code;
        document.getElementById('traktActivateLink').href = data.verification_url || 'https://auth.trakt.tv/activate';
        document.getElementById('traktInitial').style.display = 'none';
        document.getElementById('traktCodeBox').style.display = 'block';

        pollTraktToken(data.device_code, data.interval || 6);
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

    function pollTraktToken(deviceCode, interval) {
      pollInterval = setInterval(async () => {
        try {
          const res = await fetch('/api/auth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceCode })
          });
          const data = await res.json();
          if (res.ok && data.access_token) {
            clearInterval(pollInterval);
            traktToken = data.access_token;

            document.getElementById('traktCodeBox').style.display = 'none';
            document.getElementById('traktBadge').innerText = 'Connected';
            document.getElementById('traktBadge').style.color = '#34d399';
            document.getElementById('traktUser').innerText = data.username ? '@' + data.username : 'Active';
            document.getElementById('traktConnected').style.display = 'block';
            document.getElementById('installSection').style.display = 'block';

            updateUrls();
          }
        } catch (_) {}
      }, interval * 1000);
    }

    function updateUrls() {
      if (!traktToken) return;
      const simkl = document.getElementById('simklToken').value.trim();
      const configObj = {
        traktToken: traktToken,
        simklToken: simkl || undefined
      };

      const enc = btoa(JSON.stringify(configObj)).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
      const origin = window.location.origin;
      const manifest = origin + '/' + enc + '/manifest.json';
      const stremio = manifest.replace(/^https?:\\/\\//, 'stremio://');

      document.getElementById('manifestUrl').innerText = manifest;
      document.getElementById('stremioLink').href = stremio;
    }
  </script>
</body>
</html>`;
    return sendHtml(res, html);
  }

  if (pathname === '/api/auth/start' && req.method === 'POST') {
    try {
      const traktRes = await fetch(`${TRAKT_API_URL}/oauth/device/code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: TRAKT_CLIENT_ID })
      });
      const data = await traktRes.json();
      return sendJson(res, traktRes.status, data);
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (pathname === '/api/auth/token' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { deviceCode } = JSON.parse(body || '{}');
        const traktRes = await fetch(`${TRAKT_API_URL}/oauth/device/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: deviceCode,
            client_id: TRAKT_CLIENT_ID
          })
        });

        if (!traktRes.ok) {
          return sendJson(res, traktRes.status, { status: 'pending' });
        }

        const tokenData = await traktRes.json();
        let username = '';
        try {
          const userRes = await fetch(`${TRAKT_API_URL}/users/me`, {
            headers: {
              'Content-Type': 'application/json',
              'trakt-api-version': '2',
              'trakt-api-key': TRAKT_CLIENT_ID,
              'Authorization': `Bearer ${tokenData.access_token}`
            }
          });
          if (userRes.ok) {
            const userData = await userRes.json();
            username = userData.username || '';
          }
        } catch (_) {}

        savedConfig = { traktToken: tokenData.access_token, traktClientId: TRAKT_CLIENT_ID };
        try {
          fs.writeFileSync(CONFIG_FILE, JSON.stringify(savedConfig, null, 2));
        } catch (_) {}

        return sendJson(res, 200, {
          access_token: tokenData.access_token,
          username
        });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    });
    return;
  }

  const parts = pathname.replace(/^\/+|\/+$/g, '').split('/');
  let config = (savedConfig.traktToken || savedConfig.token) ? savedConfig : null;
  let offset = 0;

  const potentialConfig = parseConfigFromSegment(parts[0]);
  if (potentialConfig) {
    config = potentialConfig;
    offset = 1;
  }

  const routeParts = parts.slice(offset);

  if (routeParts.length === 1 && routeParts[0] === 'manifest.json') {
    return sendJson(res, 200, MANIFEST_TEMPLATE);
  }

  if (routeParts[0] === 'subtitles' && routeParts.length >= 3) {
    const type = routeParts[1];
    const idWithExt = routeParts[2];
    const media = parseMediaId(type, idWithExt);

    if (config && media.imdbId) {
      const syncKey = `${media.imdbId}:${media.season || 0}:${media.episode || 0}`;
      if (shouldSync(syncKey)) {
        performDynamicWatchSync(media, config).catch(() => {});
      }
    }
    return sendJson(res, 200, { subtitles: [] });
  }

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

    if (!config) return sendJson(res, 200, { metas: [] });

    try {
      const metas = await handleCatalog(catalogId, type, skip, config);
      return sendJson(res, 200, { metas });
    } catch (err) {
      return sendJson(res, 200, { metas: [] });
    }
  }

  return sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
