# Stremio & Nuvio Trakt Multi-Device Sync

A serverless, multi-device Stremio and Nuvio sync addon running on **Cloudflare Workers** (100% free, zero local servers). Bypasses Trakt's free-tier community app limitation across 5+ devices while automatically scrobbling playback and rendering rich catalogs with MetaHub artwork.

## Features
- **Zero-Secret Tap & Setup**: Configured via Cloudflare environment variables (`TRAKT_CLIENT_ID` and optional `SIMKL_CLIENT_ID`) with direct browser OAuth device flow fallback.
- **Playback Scrobbler (The Syncribullet Hook)**: Uses Stremio and Nuvio's subtitle hook (`/subtitles/:type/:id.json`) to register watched movies and episodes to Trakt and Simkl asynchronously with zero playback delay.
- **Rich Two-Way Catalogs**:
  - `Trakt - Continue Watching` (Movies & TV Shows)
  - `Trakt - Watchlist` (Movies & TV Shows with Genre filtering)
  - `Trakt - History` (Movies & TV Shows with Genre filtering)
  - `Trakt - Collection` (Movies & TV Shows with Genre filtering)
  - `Simkl - Currently Watching` (TV Shows)
  - `Simkl - Plan to Watch` (Movies & TV Shows)
  - `Simkl - Completed` (Movies)
- **High-Res MetaHub Artwork**: Automatically populates high-definition IMDb posters, fanart backgrounds, and clearlogos.
- **Multi-Device**: Run 5+ devices without triggering Trakt's session invalidation or getting logged out.

---

## 1-Minute Cloudflare Deployment

### 1. Deploy via GitHub
1. In [Cloudflare Dashboard](https://dash.cloudflare.com/), go to **Compute (Workers) -> Workers & Pages -> Create Application**.
2. Select **Connect to Git** and choose `nepalanurag/stremio-trakt-sync`.
3. Set Environment Variables under **Settings -> Variables and Secrets**:
   - `TRAKT_CLIENT_ID`: Your Trakt API Client ID (Secret)
   - `SIMKL_CLIENT_ID`: Your Simkl API Client ID (Secret)
4. Click **Deploy**. Cloudflare gives you:
   `https://stremio-trakt-sync.<your-subdomain>.workers.dev`

---

## Tap & Setup

1. Open your Worker URL in any browser:
   `https://stremio-trakt-sync.<your-subdomain>.workers.dev/configure`
2. Click **Tap to Connect Trakt**.
3. Open **https://auth.trakt.tv/activate** in a new tab, paste your activation code, and approve.
4. (Optional) Click **Tap to Connect Simkl**, open **https://simkl.com/pin**, and approve.
5. Tap **🚀 Install in Stremio (1-Click)** or copy the manifest URL into Nuvio.
