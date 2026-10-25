# vertext · Speaker pilot

A local-first speaker workspace for a one- or two-talk conference pilot. Speakers add conference links and private materials, review the extracted text, approve sources, prepare a talk-specific TrueForge agent, and publish or end the session. Afterward, the app can produce a report from any available consented questions and show a speaker-facing network visualization.

## What is implemented

- Speaker and talk setup, including conference links and schedule.
- Public URL capture through Bright Data Browser API.
- Speaker-provided text plus PDF, DOCX, TXT, and Markdown ingestion.
- A review preview and explicit per-source approval step.
- Talk-specific agent creation using the TrueForge SDK and an OpenAI model configured in TrueForge.
- Draft, ready, live, and ended session states.
- A consent-gated anonymous activity intake endpoint for the attendee experience.
- OpenAI grouping and synthesis of aggregate speaker feedback.
- Reports that summarize any available number of consented questions, including a single question.
- Deletion of raw question text after report generation; reports retain aggregate themes only.
- An in-app network visualization of the talk, approved sources, and attendee themes.
- Qodo review is part of the GitHub pull request workflow, not the running app.

## Requirements

- Node.js 22.14 or newer. TrueForge’s local runtime requires this version.
- npm.
- API credentials for services you want to connect. The app can start without them, but the matching integration actions remain unavailable.

## Run locally

1. Start TrueForge in a separate terminal:

   ```bash
   npx @truefoundry/trueforge@latest
   ```

   Open `http://localhost:8790`, configure an OpenAI provider under **Settings → Models**, and note the model’s TrueForge name.

2. Install dependencies and configure environment variables:

   ```bash
   npm install
   cp .env.example .env
   ```

   Set `OPENAI_API_KEY`, `BRIGHTDATA_BROWSER_API_USERNAME`, and `BRIGHTDATA_BROWSER_API_PASSWORD` in `.env`. Set `TRUEFORGE_BASE_URL` and `TRUEFORGE_MODEL` to the TrueForge server/model you configured.

3. Start the speaker workspace:

   ```bash
   npm run dev
   ```

   Open `http://localhost:5173`.

## Integrations

- **TrueForge:** The app creates one saved agent per talk from the explicitly approved source text. The model must already be configured in the TrueForge server. `TRUEFORGE_TOKEN` is optional for local no-login mode and required when the server expects bearer authentication.
- **OpenAI:** `OPENAI_API_KEY` and `OPENAI_REPORT_MODEL` are used by the post-talk aggregation flow. Requests set `store: false`. Raw questions are not included in the generated speaker report.
- **Bright Data Browser API:** `BRIGHTDATA_BROWSER_API_USERNAME` and `BRIGHTDATA_BROWSER_API_PASSWORD` are required to fetch public pages. Use the credentials from the Browser API zone overview in your Bright Data account. Vertext connects to `brd.superproxy.io:9222` over Browser API's WebSocket endpoint, loads only the URL the speaker explicitly added, and extracts its visible page text. Browser API uses zone credentials rather than a standalone API key or Fetch dataset ID. See [Bright Data Browser API documentation](https://docs.brightdata.com/scraping-automation/scraping-browser/introduction).
- **Speaker network visualization:** The UI builds the network from saved talk details, approved sources, and generated report themes. It does not represent individual attendee activity.
- **Qodo:** `.pr_agent.toml` requests an automatic agentic review on pull requests. Install the Qodo GitHub App for this private repository and merge the configuration into the default branch for it to take effect. Review findings as part of the normal PR process. Do not include attendee question text or private speaker source contents in PR comments.

## Attendee activity API contract

The speaker service exposes an intake route for the attendee-side companion:

```http
POST /api/talks/:talkId/activity
Content-Type: application/json

{"consent": true, "question": "Can you explain the prerequisite concept?"}
```

It accepts only live-session activity, requires explicit consent, and accepts no attendee identifier. The attendee experience must display its privacy notice before sending activity. On report generation, the server clears the raw questions from local storage whether or not a safe aggregate can be produced.

## Local data and privacy limits

This pilot stores talk setup, uploaded source text, consented raw questions, and reports in `server/data/store.json`; uploaded files are parsed in memory and are not retained as binary files. The store file is created with owner-only permissions. Raw questions are removed when a report is generated, but they remain on disk until that point. Reports can summarize any available number of consented questions; there is no minimum question threshold.

The app is bound to `127.0.0.1` and has no user login or multi-tenant authorization. **Do not expose this pilot to a public network or use it for a live conference until authentication, deployment-grade storage/security, retention controls, and an event-approved privacy notice are implemented.** Local TrueForge mode is also for personal development only.

## Project structure

- `client/` — React speaker workspace.
- `server/src/` — API, source ingestion, TrueForge, and OpenAI integrations.
- `server/data/` — local state and uploads.
- `.env.example` — integration configuration.
