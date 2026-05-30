# LMS Wrong Answer Analyzer

## What it does
- Takes an LMS attempt URL and credentials/token/cookies.
- Uses Playwright to open the page and collect all wrong questions.
- Sends wrong questions to AI for explanation and review domains.
- Supports GitHub Device Login to get token and analyze via GitHub Copilot endpoint.
- Shows a summarized report in a web UI.

## Setup
1. Install Node.js LTS.
2. Install dependencies:
   - `npm install`
3. Copy env file:
   - `copy .env.example .env`
4. Fill `OPENAI_API_KEY` in `.env` (or enter key in UI).
5. Optional for Device Login: set `GITHUB_CLIENT_ID` in `.env` (or enter in UI).
5. Start server:
   - `npm start`
6. Open:
   - `http://localhost:3000`

## Deploy on Render (single website for FE + BE)
This project already uses one Express server to serve both frontend (`public/`) and backend APIs (`/api/*`), so deploy as a single Render Web Service.

### Option A: Blueprint (recommended)
1. Push code to GitHub.
2. In Render, choose `New +` -> `Blueprint`.
3. Select this repository (Render will read `render.yaml`).
4. Set secret env vars in Render dashboard:
   - `OPENAI_API_KEY` (if using OpenAI provider)
   - `GITHUB_CLIENT_ID` (for Device Login)
   - Optional: `GITHUB_COPILOT_CHAT_URL`, `GITHUB_COPILOT_MODEL`
5. Deploy.

### Option B: Manual Web Service
1. In Render, choose `New +` -> `Web Service`.
2. Connect repository.
3. Choose `Environment: Docker`.
4. Render will use `Dockerfile` and expose one public URL.
5. Add the same environment variables above.

### How FE + BE are served together
- Frontend: `GET /` -> static files from `public/`
- Backend API: `POST /api/collect`, `POST /api/analyze`, `POST /api/collect-analyze`
- Health check: `GET /health`

## Device Login flow (GitHub)
1. In the UI, open `GitHub Device Login` section.
2. Enter OAuth App `Client ID` (or use `GITHUB_CLIENT_ID` in env).
3. Click `Start Device Login`.
4. Open the shown verification URL and approve.
5. Click `Check Approval`.
6. Token is auto-filled into `GitHub Token`, and provider switches to `GitHub Copilot`.

## Notes
- Some LMS layouts differ. If extraction misses questions, adjust selectors in `src/lmsCollector.js`.
- For 2FA/CAPTCHA accounts, automated login may fail and requires manual session cookies.
- Store account data securely; do not commit secrets.
