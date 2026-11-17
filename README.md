# Stremio & Nuvio Trakt Multi-Device Sync (Syncribullet Engine)

A serverless, multi-device Stremio and Nuvio addon designed to run on **Cloudflare Workers** (100% free, zero local servers). It connects to your Trakt account and bypasses Trakt's free-tier 1-community-app cap across 5+ devices while automatically scrobbles playback to Trakt (and optionally Simkl).

## Why This Exists
- **Trakt Free Tier Cap**: Trakt restricts free accounts to 1 third-party community app. When 5 separate devices sign in directly, Trakt repeatedly kicks earlier devices off.
- **The Solution**: This addon runs as a single serverless gateway on Cloudflare Workers using your personal Trakt API credentials. Trakt only ever records 1 connected application.
- **Playback Scrobbler (The Syncribullet Hook)**: Uses Stremio and Nuvio's subtitle request hook (`/subtitles/:type/:id.json`) to automatically register watched movies and episodes to Trakt and Simkl without delaying video playback.

---

## 1-Minute Cloudflare Workers Setup

### Step 1: Create a Personal Trakt App
1. Go to [https://trakt.tv/oauth/applications](https://trakt.tv/oauth/applications) and click **New Application**.
2. Set:
   - **Name**: `Stremio Sync Addon`
   - **Redirect uri**: `urn:ietf:wg:oauth:2.0:oob`
   - **Permissions**: check `/sync` and `/scrobble`
3. Save and copy your **Client ID** and **Client Secret**.

### Step 2: Deploy to Cloudflare Workers

#### Option A: Via GitHub (Recommended)
1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) -> **Compute (Workers) -> Workers & Pages**.
2. Click **Create Application -> Pages or Workers -> Connect to Git**.
3. Select this repository and click **Deploy**.

#### Option B: Direct Paste
1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) -> **Workers & Pages -> Create Application -> Create Worker**.
2. Name it `stremio-trakt-sync` and click **Deploy**.
3. Click **Edit Code**, paste the contents of `worker.js`, and click **Deploy**.

### Step 3: Configure and Install
1. Open `https://stremio-trakt-sync.<your-subdomain>.workers.dev/configure` in your browser.
2. Enter your Trakt **Client ID** and **Client Secret** (and optional Simkl token).
3. Click **Connect Trakt Account**, open [trakt.tv/activate](https://trakt.tv/activate), and enter the code.
4. Click **Install in Stremio** or copy the manifest URL into Nuvio.

---

## Features
- **Dynamic Scrobble Sync**: Automatically marks movies and episodes watched on Trakt & Simkl on playback start.
- **Catalogs**: Continue Watching, Watchlist, and History directly inside Stremio and Nuvio.
- **Zero Local Footprint**: 100% serverless, no local machine or port forwarding needed.
- **Self-Hosting (Optional)**: Can also be run locally with `npm start` or via Docker.
