// Cloudflare Worker: Syncribullet Trakt & Multi-Tracker Addon
// 100% Serverless, Tap-and-Setup flow with zero secrets required.

const DEFAULT_TRAKT_CLIENT_ID = '';
const TRAKT_API_URL = 'https://api.trakt.tv';
const SIMKL_API_URL = 'https://api.simkl.com';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const MANIFEST = {
  id: 'org.syncribullet.cfworker',
  version: '2.2.0',
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

async function handleCatalog(catalogId, type, skip, config, defaultClientId) {
  const token = config.traktToken || config.token;
  const clientId = config.traktClientId || config.clientId || defaultClientId;
  if (!token || !clientId) return [];

  const page = Math.floor(skip / 20) + 1;
  let endpoint = '';

  if (catalogId === 'trakt_playback_movies') endpoint = '/sync/playback/movies?extended=full';
  else if (catalogId === 'trakt_playback_series') endpoint = '/sync/playback/episodes?extended=full';
  else if (catalogId === 'trakt_watchlist_movies') endpoint = `/sync/watchlist/movies?extended=full&page=${page}&limit=20`;
  else if (catalogId === 'trakt_watchlist_series') endpoint = `/sync/watchlist/shows?extended=full&page=${page}&limit=20`;
  else if (catalogId === 'trakt_history_movies') endpoint = `/sync/history/movies?extended=full&page=${page}&limit=20`;
  else if (catalogId === 'trakt_history_series') endpoint = `/sync/history/shows?extended=full&page=${page}&limit=20`;
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

  if (catalogId === 'trakt_playback_series') {
    const seen = new Set();
    const items = [];
    for (const item of data) {
      if (item.show?.ids?.trakt && !seen.has(item.show.ids.trakt)) {
        seen.add(item.show.ids.trakt);
        const meta = mapToMeta(item, 'series');
        if (meta) items.push(meta);
      }
    }
    return items;
  }
  return data.map(i => mapToMeta(i, type)).filter(Boolean);
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

    <!-- Trakt One-Tap Section -->
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

    <!-- Simkl Optional Section -->
    <div class="section">
      <div class="section-title">
        <span>2. Simkl (Optional)</span>
        <span id="simklBadge" style="font-size:0.8rem; color:#94a3b8;">Optional</span>
      </div>
      <p style="font-size:0.85rem; margin:0 0 0.5rem 0;">Cross-syncs playback to Simkl at the same time.</p>
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

    <!-- Step 3: 1-Click Install -->
    <div id="installSection" style="display:none; margin-top:1.5rem;">
      <a id="stremioLink" class="btn btn-green" href="#">🚀 Install in Stremio (1-Click)</a>
      <p style="margin:1.25rem 0 0.25rem 0; font-size:0.85rem; font-weight:600; color:#cbd5e1;">Or copy Manifest URL into Nuvio / Stremio Web:</p>
      <div id="manifestUrl" class="url-display"></div>
    </div>
  </div>

  <script>
    let traktToken = '';
    let simklToken = '';
    let pollInterval = null;
    let simklPollInterval = null;

    async function startTrakt() {
      const btn = document.getElementById('btnTrakt');
      btn.disabled = true;
      btn.innerText = 'Requesting code...';

      try {
        const res = await fetch('/api/auth/start', { method: 'POST' });
        const text = await res.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch (_) {
          throw new Error('Server returned: ' + text.slice(0, 100));
        }

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

    async function startSimkl() {
      const btn = document.getElementById('btnSimkl');
      btn.disabled = true;
      btn.innerText = 'Requesting Simkl PIN...';

      try {
        const res = await fetch('/api/simkl/start', { method: 'POST' });
        const text = await res.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch (_) {
          throw new Error('Server returned: ' + text.slice(0, 100));
        }

        if (!res.ok) {
          alert(data.error || 'Set SIMKL_CLIENT_ID in Cloudflare or paste token below');
          btn.disabled = false;
          btn.innerText = 'Tap to Connect Simkl';
          return;
        }

        document.getElementById('simklUserCode').innerText = data.user_code;
        document.getElementById('simklBtnWrap').style.display = 'none';
        document.getElementById('simklCodeBox').style.display = 'block';

        pollSimklToken(data.device_code, data.interval || 5);
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

    function pollSimklToken(deviceCode, interval) {
      simklPollInterval = setInterval(async () => {
        try {
          const res = await fetch('/api/simkl/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceCode })
          });
          const data = await res.json();
          if (res.ok && data.access_token) {
            clearInterval(simklPollInterval);
            simklToken = data.access_token;
            document.getElementById('simklToken').value = simklToken;
            document.getElementById('simklCodeBox').style.display = 'none';
            document.getElementById('simklBadge').innerText = 'Connected';
            document.getElementById('simklBadge').style.color = '#34d399';
            document.getElementById('simklConnected').style.display = 'block';
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
        return new Response(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      // Trakt Device Code: Start
      if (pathname === '/api/auth/start' && request.method === 'POST') {
        if (!traktClientId) {
          return jsonResponse({ error: 'TRAKT_CLIENT_ID environment variable is missing in Cloudflare' }, 400);
        }
        try {
          const res = await fetch(`${TRAKT_API_URL}/oauth/device/code`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'User-Agent': USER_AGENT
            },
            body: JSON.stringify({ client_id: traktClientId })
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
        if (!traktClientId) {
          return jsonResponse({ error: 'TRAKT_CLIENT_ID environment variable is missing' }, 400);
        }
        const { deviceCode } = await request.json();
        try {
          const res = await fetch(`${TRAKT_API_URL}/oauth/device/token`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'User-Agent': USER_AGENT
            },
            body: JSON.stringify({
              code: deviceCode,
              client_id: traktClientId
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
                'User-Agent': USER_AGENT,
                'trakt-api-version': '2',
                'trakt-api-key': traktClientId,
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
        return jsonResponse(MANIFEST);
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

        let skip = 0;
        if (extraSegment && extraSegment.includes('skip=')) {
          const match = extraSegment.match(/skip=(\d+)/);
          if (match) skip = parseInt(match[1], 10);
        }

        if (!config) return jsonResponse({ metas: [] });
        const metas = await handleCatalog(catalogId, type, skip, config, traktClientId);
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
