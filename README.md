# Voyager – Autonomous Travel Coordination Agent

A chat-based agent that takes a destination, dates, budget, travelers and preferences, then calls simulated travel tools over several steps, compares alternatives against your constraints, drafts an itinerary, asks for missing information, and books **only after explicit confirmation**.

Zero runtime dependencies. Node 20+.

## Quick start
```bash
cp .env.example .env     # optional
npm start                # http://localhost:3000
npm test                 # 7 tests (unit + HTTP API)
docker build -t voyager . && docker run -p 3000:3000 -v voyager-data:/data voyager
```

## Troubleshooting
- **"Unexpected end of JSON input" / "did not return JSON"**: the page is not being served by the Voyager backend (for example opened as a file, or through Live Server/another static host). Run `npm start` and open **http://localhost:3000**. To host the UI elsewhere, open it with `?api=http://localhost:3000` (localhost origins are allowed by CORS automatically; set `CORS_ORIGIN` for others).
- Port in use: `PORT=3001 npm start`.

## Architecture
```
server.js            entry point, graceful shutdown (flushes state on SIGTERM/SIGINT)
src/
  config.js          env + .env loading, defaults
  httpApp.js         router, validation, rate limit, CORS, security headers, static, errors, JSON logs
  validate.js        request validation (returns 422 with details)
  store.js           session store: TTL expiry + atomic JSON persistence (data/state.json)
  chat.js            conversation layer: trip draft, missing-info questions, confirm gate
  nlu.js             rule-based message -> trip fields extractor
  agent.js           planning workflow, tool-call logging, booking
  llmAgent.js        Claude tool-use loop (model picks tools; execute_booking is never exposed)
  tools.js           mock tools + JSON schemas (replace run() with real APIs)
public/              chat UI (index.html, styles.css, app.js, bg.svg)
test/                node:test suites
```

## API
| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/health` | | status, uptime, session count, llm on/off |
| GET | `/api/tools` | | tool names, descriptions, JSON schemas |
| POST | `/api/chat` | `{sessionId?, message, mode?}` | conversational turn; returns `events, plan, state, draft` |
| POST | `/api/plan` | `{request, mode?}` | structured planning, returns `trace, plan, state` |
| POST | `/api/book` | `{sessionId, confirmed}` | the only path that executes a booking |
| GET | `/api/sessions/:id` | | fetch a session |
| DELETE | `/api/sessions/:id` | | delete a session |

Errors are JSON: `{error, details?, requestId}` with 400 (bad JSON / llm without key), 404, 405, 409 (nothing awaiting confirmation), 413, 422 (validation), 429 (rate limit), 500.

```bash
curl -s localhost:3000/api/chat -H 'content-type: application/json' \
  -d '{"message":"Delhi to Lisbon, Dec 1-6, 2 people, $3200"}'
```

## Configuration (env)
| Var | Default | Purpose |
|---|---|---|
| PORT / HOST | 3000 / 0.0.0.0 | listen address |
| DATA_DIR | ./data | persisted sessions and holds |
| PERSIST | true | `false` = memory only |
| SESSION_TTL_MIN | 120 | idle session expiry |
| RATE_LIMIT_PER_MIN | 60 | per-IP limit on `/api/*` |
| CORS_ORIGIN | (off) | allow a separate frontend origin |
| ANTHROPIC_API_KEY, MODEL | (off), claude-sonnet-4-6 | enables `mode: "llm"` |
| LOG | info | `silent` disables request logs |

## Agent workflow (walkthrough)
1. **Understand:** `nlu.js` extracts fields from each message into a persistent trip draft.
2. **Validate:** `check_missing` runs; missing fields trigger a clarifying question instead of a plan.
3. **Search (tool selection):** `search_flights`, `search_hotels`, `search_transport` receive travelers, dates, nonstop, star and area constraints.
4. **Compare:** `compare_options` scores every flight x hotel x transport combination against the budget; if nothing fits it reports the cheapest option and the overage.
5. **Itinerary:** `build_itinerary` builds a day-by-day plan from interests.
6. **Hold and confirm:** `prepare_booking` creates a hold. `execute_booking` runs only via `/api/book` (or the chat "confirm") with `confirmed: true`, once per hold.

## Security notes
Input validation and size limits, per-IP rate limiting, path-traversal-safe static serving, CSP and nosniff headers, no secrets in responses. There is no user authentication; put it behind your own auth or gateway before exposing it publicly, and note that rate limiting keys on the socket IP (configure your proxy accordingly).

## Going real
Replace the bodies of the search tools in `src/tools.js` with calls to flight, hotel and transport APIs. Swap `store.js` for Redis or a database to scale beyond one instance.
