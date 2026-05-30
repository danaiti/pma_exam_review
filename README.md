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
