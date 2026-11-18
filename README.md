# Stremio & Nuvio Trakt Multi-Device Sync

A serverless, multi-device Stremio and Nuvio sync addon on **Cloudflare Workers** (100% free, zero local servers). Bypasses Trakt's free-tier device caps across 5+ devices while automatically scrobbling playback to Trakt (and optionally Simkl).

## Features
- **Zero-Secret Tap & Setup**: Configured via Cloudflare environment variables (`TRAKT_CLIENT_ID` and optional `SIMKL_CLIENT_ID`) with zero client secrets needed.
- **Playback Scrobbler (The Syncribullet Hook)**: Uses Stremio and Nuvio's subtitle hook (`/subtitles/:type/:id.json`) to register watched movies and episodes to Trakt and Simkl asynchronously without slowing down video playback.
- **Two-Way Catalogs**: Exposes your Trakt Continue Watching, Watchlist, and History directly into your home screen.
- **Multi-Device**: Run 5+ devices without ever triggering Trakt's 1-community-app session invalidation or getting logged out.

---

## 1-Minute Cloudflare Deployment

### 1. Deploy via GitHub
1. In [Cloudflare Dashboard](https://dash.cloudflare.com/), go to **Compute (Workers) -> Workers & Pages -> Create Application**.
2. Select **Connect to Git** and choose `nepalanurag/stremio-trakt-sync`.
3. Click **Save and Deploy**. Cloudflare gives you:
   `https://stremio-trakt-sync.<your-subdomain>.workers.dev`

*(Optional)*: If you want to customize environment variables, go to **Settings -> Variables and Secrets**:
- `TRAKT_CLIENT_ID`: override default Trakt client ID (optional)
- `SIMKL_CLIENT_ID`: optional client ID for Simkl

---

## Tap & Setup (No Manual Keys Needed)

1. Open your Worker URL in any browser:
   `https://stremio-trakt-sync.<your-subdomain>.workers.dev/configure`
2. Click **Tap to Connect Trakt**.
3. Click the link to open **https://auth.trakt.tv/activate** and enter the code.
4. As soon as you approve, the page automatically detects your login and shows:
   - **Install in Stremio (1-Click)**
   - **Copy Manifest URL for Nuvio**
5. Install on all 5+ of your devices.
