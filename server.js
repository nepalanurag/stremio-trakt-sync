import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 7070;
const TRAKT_CLIENT_ID = (process.env.TRAKT_CLIENT_ID || '').trim();
const SIMKL_CLIENT_ID = (process.env.SIMKL_CLIENT_ID || '').trim();
const TRAKT_API_URL = 'https://api.trakt.tv';
const SIMKL_API_URL = 'https://api.simkl.com';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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
    extra: [{ name: 'skip', isRequired: false }]
  },
  {
    type: 'movie',
    id: 'trakt_playback_movies',
    name: 'Trakt - Continue Watching',
    extra: [{ name: 'skip', isRequired: false }]
  },
  {
    type: 'movie',
    id: 'trakt_watchlist_movies',
    name: 'Trakt - Watchlist',
    extra: [
      { name: 'genre', isRequired: false, options: GENRE_OPTIONS },
      { name: 'skip', isRequired: false }
    ]
  },
  {
    type: 'series',
    id: 'trakt_watchlist_series',
    name: 'Trakt - Watchlist',
    extra: [
      { name: 'genre', isRequired: false, options: GENRE_OPTIONS },
      { name: 'skip', isRequired: false }
    ]
  },
  {
    type: 'movie',
    id: 'trakt_history_movies',
    name: 'Trakt - History',
    extra: [
      { name: 'genre', isRequired: false, options: GENRE_OPTIONS },
      { name: 'skip', isRequired: false }
    ]
  },
  {
    type: 'series',
    id: 'trakt_history_series',
    name: 'Trakt - History',
    extra: [
      { name: 'genre', isRequired: false, options: GENRE_OPTIONS },
      { name: 'skip', isRequired: false }
    ]
  },
  {
    type: 'movie',
    id: 'trakt_collection_movies',
    name: 'Trakt - Collection',
    extra: [
      { name: 'genre', isRequired: false, options: GENRE_OPTIONS },
      { name: 'skip', isRequired: false }
    ]
  },
  {
    type: 'series',
    id: 'trakt_collection_series',
    name: 'Trakt - Collection',
    extra: [
      { name: 'genre', isRequired: false, options: GENRE_OPTIONS },
      { name: 'skip', isRequired: false }
    ]
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
    id: 'org.multisync.stremio',
    version: '2.6.2',
    name: 'MultiSync (Trakt & Simkl)',
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

async function fetchTrakt(endpoint, token, clientId, method = 'GET', body = null) {
  const url = `${TRAKT_API_URL}${endpoint}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': USER_AGENT,
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

async function performDynamicWatchSync(media, config) {
  const traktToken = config.traktToken || config.token;
  const traktClientId = config.traktClientId || config.clientId || TRAKT_CLIENT_ID;

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
}

async function handleCatalog(catalogId, type, extraSegment, config) {
  const token = config.traktToken || config.token;
  const clientId = config.traktClientId || config.clientId || TRAKT_CLIENT_ID;
  if (!token || !clientId) return [];

  let skip = 0;
  let selectedGenre = null;

  if (extraSegment) {
    const skipMatch = extraSegment.match(/skip=(\d+)/);
    if (skipMatch) skip = parseInt(skipMatch[1], 10);

    const genreMatch = extraSegment.match(/genre=([^&]+)/);
    if (genreMatch) selectedGenre = decodeURIComponent(genreMatch[1]).toLowerCase();
  }

  const page = Math.floor(skip / 20) + 1;
  const limit = 20;

  let endpoint = '';
  if (catalogId === 'trakt_playback_movies') endpoint = '/sync/playback/movies?extended=full';
  else if (catalogId === 'trakt_playback_series') endpoint = '/sync/playback/episodes?extended=full';
  else if (catalogId === 'trakt_watchlist_movies') endpoint = `/sync/watchlist/movies?extended=full&page=${page}&limit=${limit}`;
  else if (catalogId === 'trakt_watchlist_series') endpoint = `/sync/watchlist/shows?extended=full&page=${page}&limit=${limit}`;
  else if (catalogId === 'trakt_history_movies') endpoint = `/sync/history/movies?extended=full&page=${page}&limit=50`;
  else if (catalogId === 'trakt_history_series') endpoint = `/sync/history/episodes?extended=full&page=${page}&limit=50`;
  else if (catalogId === 'trakt_collection_movies') endpoint = `/sync/collection/movies?extended=full&page=${page}&limit=${limit}`;
  else if (catalogId === 'trakt_collection_series') endpoint = `/sync/collection/shows?extended=full&page=${page}&limit=${limit}`;
  if (!endpoint) return [];

  const data = await fetchTrakt(endpoint, token, clientId);
  let items = [];

  if (catalogId === 'trakt_playback_series' || catalogId === 'trakt_history_series') {
    const seen = new Set();
    for (const item of data) {
      const showId = item.show?.ids?.trakt || item.show?.ids?.imdb;
      if (showId && !seen.has(showId)) {
        seen.add(showId);
        const meta = mapToMeta(item, 'series');
        if (meta) items.push(meta);
      }
    }
  } else if (catalogId === 'trakt_history_movies') {
    const seen = new Set();
    for (const item of data) {
      const movieId = item.movie?.ids?.trakt || item.movie?.ids?.imdb;
      if (movieId && !seen.has(movieId)) {
        seen.add(movieId);
        const meta = mapToMeta(item, 'movie');
        if (meta) items.push(meta);
      }
    }
  } else {
    items = data.map(i => mapToMeta(i, type)).filter(Boolean);
  }

  const isAllGenre = !selectedGenre || ['all', 'all genres', 'all-genres'].includes(selectedGenre) || selectedGenre.startsWith('all');
  if (!isAllGenre) {
    items = items.filter(item =>
      Array.isArray(item.genres) &&
      item.genres.some(g => g.toLowerCase().includes(selectedGenre))
    );
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
    return sendJson(res, 200, buildManifest(config));
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

    if (!config) return sendJson(res, 200, { metas: [] });

    try {
      const metas = await handleCatalog(catalogId, type, extraSegment, config);
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
