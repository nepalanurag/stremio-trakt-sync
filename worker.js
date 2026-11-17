// Cloudflare Worker: Syncribullet Trakt & Multi-Tracker Addon
// Runs 100% serverless on Cloudflare's free tier (no local servers needed).

const TRAKT_API_URL = 'https://api.trakt.tv';
const SIMKL_API_URL = 'https://api.simkl.com';

const MANIFEST = {
  id: 'org.syncribullet.cfworker',
  version: '2.0.0',
  name: 'Syncribullet Trakt Sync',
  description: 'Serverless Trakt & Simkl playback scrobbler and catalog sync across unlimited devices.',
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
  if (!media.imdbId.startsWith('tt')) return;
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
      'trakt-api-version': '2',
      'trakt-api-key': clientId,
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
}

async function syncToSimkl(media, token) {
  if (!media.imdbId.startsWith('tt')) return;
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

async function handleCatalog(catalogId, type, skip, config) {
  const token = config.traktToken || config.token;
  const clientId = config.traktClientId || config.clientId;
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

    const url = new URL(request.url);
    const pathname = url.pathname;

    // Web Dashboard / Setup UI
    if (pathname === '/' || pathname === '/configure') {
      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Syncribullet Cloudflare Serverless</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0f19; color: #f1f5f9; margin: 0; padding: 2rem; display: flex; justify-content: center; }
    .card { background: #161e2e; border-radius: 14px; padding: 2rem; max-width: 600px; width: 100%; box-shadow: 0 10px 30px rgba(0,0,0,0.6); border: 1px solid #1e293b; }
    h1 { font-size: 1.4rem; color: #38bdf8; margin-top: 0; }
    p { color: #94a3b8; font-size: 0.9rem; line-height: 1.5; }
    label { display: block; margin-top: 1.25rem; font-weight: 600; font-size: 0.85rem; color: #cbd5e1; }
    input { width: 100%; padding: 0.75rem; margin-top: 0.25rem; border: 1px solid #334155; border-radius: 6px; background: #0b0f19; color: #fff; box-sizing: border-box; }
    button { background: #0284c7; color: white; border: none; border-radius: 6px; padding: 0.75rem; font-weight: 600; margin-top: 1.25rem; cursor: pointer; width: 100%; }
    .code-box { background: #0b0f19; border: 1px dashed #38bdf8; border-radius: 8px; padding: 1.25rem; margin-top: 1rem; text-align: center; }
    .user-code { font-size: 2rem; font-weight: bold; letter-spacing: 5px; color: #38bdf8; margin: 0.5rem 0; }
    .btn-install { background: #10b981; margin-top: 1rem; text-decoration: none; display: block; text-align: center; color: white; padding: 0.85rem; border-radius: 6px; font-weight: 600; }
    .url-display { background: #0b0f19; word-break: break-all; padding: 0.75rem; border-radius: 6px; font-family: monospace; font-size: 0.8rem; color: #a5f3fc; margin-top: 0.5rem; border: 1px solid #1e293b; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Serverless Trakt Multi-Device Sync</h1>
    <p>Zero local servers required. Operates directly on Cloudflare Workers to sync playback and catalogs across 5+ Stremio and Nuvio devices.</p>

    <label for="clientId">Trakt Client ID (from trakt.tv/oauth/applications):</label>
    <input id="clientId" placeholder="Paste Client ID">

    <label for="clientSecret">Trakt Client Secret:</label>
    <input id="clientSecret" type="password" placeholder="Paste Client Secret">

    <label for="simklToken">Simkl Access Token (Optional):</label>
    <input id="simklToken" placeholder="Leave blank if not using Simkl">

    <button id="btnStart" onclick="startAuth()">Connect Trakt Account</button>

    <div id="stepCode" class="code-box" style="display:none;">
      <p style="margin:0;">Open <a id="verifyUrl" href="https://trakt.tv/activate" target="_blank" style="color:#38bdf8; font-weight:bold;">trakt.tv/activate</a> and enter:</p>
      <div id="userCode" class="user-code">----</div>
      <p style="font-size:0.8rem; margin:0; color:#94a3b8;">Waiting for authorization...</p>
    </div>

    <div id="stepInstall" style="display:none; margin-top:1.5rem;">
      <a id="stremioLink" class="btn-install" href="#">Install in Stremio</a>
      <p style="margin-top:1rem; margin-bottom:0.25rem;">Manifest URL (for Nuvio or Stremio Web):</p>
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

      const res = await fetch('/api/auth/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret })
      });
      const data = await res.json();
      if (!res.ok) {
        document.getElementById('btnStart').disabled = false;
        return alert(data.error || 'Failed to start auth');
      }

      document.getElementById('userCode').innerText = data.user_code;
      document.getElementById('verifyUrl').href = data.verification_url;
      document.getElementById('stepCode').style.display = 'block';
      document.getElementById('btnStart').style.display = 'none';

      pollToken(data.device_code, clientId, clientSecret, data.interval || 5);
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
            const origin = window.location.origin;
            const manifest = origin + '/' + enc + '/manifest.json';
            const stremio = manifest.replace(/^https?:\\/\\//, 'stremio://');

            document.getElementById('manifestUrl').innerText = manifest;
            document.getElementById('stremioLink').href = stremio;
          }
        } catch (_) {}
      }, interval * 1000);
    }
  </script>
</body>
</html>`;
      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // Trakt Device Code APIs
    if (pathname === '/api/auth/start' && request.method === 'POST') {
      const { clientId } = await request.json();
      const res = await fetch(`${TRAKT_API_URL}/oauth/device/code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId })
      });
      return jsonResponse(await res.json(), res.status);
    }

    if (pathname === '/api/auth/token' && request.method === 'POST') {
      const { deviceCode, clientId, clientSecret } = await request.json();
      const res = await fetch(`${TRAKT_API_URL}/oauth/device/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: deviceCode,
          client_id: clientId,
          client_secret: clientSecret
        })
      });
      return jsonResponse(await res.json(), res.status);
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

    // Subtitles Hook (Asynchronous Dynamic Scrobble via ctx.waitUntil)
    if (routeParts[0] === 'subtitles' && routeParts.length >= 3) {
      const type = routeParts[1];
      const idWithExt = routeParts[2];
      const media = parseMediaId(type, idWithExt);

      if (config && media.imdbId) {
        const traktToken = config.traktToken || config.token;
        const traktClientId = config.traktClientId || config.clientId;

        // ctx.waitUntil keeps the Worker alive in the background while instantly returning subtitles response
        if (ctx && ctx.waitUntil) {
          ctx.waitUntil((async () => {
            if (traktToken && traktClientId) {
              await syncToTrakt(media, traktToken, traktClientId).catch(() => {});
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
      const metas = await handleCatalog(catalogId, type, skip, config);
      return jsonResponse({ metas });
    }

    return jsonResponse({ error: 'Not found' }, 404);
  }
};
