# FedEx Package Investigator — API Mode

Queries the **FedEx Track API** with your developer credentials, then **Grok** analyzes scan history and explains delays. Deploy on Railway.

## How It Works

1. User enters a FedEx tracking number on `primaryvowels.com/service/`
2. Server authenticates with FedEx OAuth (`client_credentials`)
3. Calls `POST /track/v1/trackingnumbers` with detailed scans
4. Extracts status, location, delays, ETA into findings
5. Grok reads the data + user context and writes a plain-English analysis
6. If package is stale/delayed → schedules automatic API re-check in 24h
7. Optional SMS at each step via Twilio

No phone calls. No Twilio required for core functionality.

## Setup FedEx API Credentials

1. Go to [developer.fedex.com](https://developer.fedex.com/) → sign up / log in
2. **Create Project** → enable **Track API**
3. Copy **API Key** (Client ID) and **Secret Key** (Client Secret)
4. Add your **FedEx shipper account number** (9 digits) for richer data
5. Start with `FEDEX_ENV=sandbox` — use test tracking `123456789012`

Switch to production when ready:

```
FEDEX_ENV=production
```

## Deploy to Railway

1. [railway.app](https://railway.app/) → **New Project** → deploy from GitHub
2. Root directory: `service/server`
3. **Networking** → Generate Domain
4. **Variables**:

```
FEDEX_API_KEY=your-client-id
FEDEX_API_SECRET=your-secret
FEDEX_ACCOUNT_NUMBER=123456789
FEDEX_ENV=sandbox
XAI_API_KEY=xai-...
DATA_DIR=/data
```

5. **Add Volume** at `/data` (persists investigation history)
6. Set `service/config.js`:

```javascript
window.PV_AGENT_URL = 'https://your-app.up.railway.app';
```

## Optional: SMS via Twilio

```
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1...
SMS_ENABLED=true
```

## Local Development

```bash
cd service/server
npm install
cp .env.example .env
npm run dev
```

Sandbox test numbers: `123456789012` (in transit), `111111111111` (delivered)

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | `fedexApi`, `grok`, `sms` status |
| POST | `/api/investigate` | Start full investigation (async) |
| GET | `/api/investigations/:id` | Poll status + findings |
| POST | `/api/track` | Quick one-shot track + analysis |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FEDEX_API_KEY` | Yes | FedEx Client ID |
| `FEDEX_API_SECRET` | Yes | FedEx Client Secret |
| `FEDEX_ACCOUNT_NUMBER` | Recommended | Your 9-digit shipper account |
| `FEDEX_ENV` | No | `sandbox` (default) or `production` |
| `XAI_API_KEY` | Recommended | Grok analysis (falls back to rules if missing) |
| `GROK_MODEL` | No | Default `grok-3-mini` |
| `TWILIO_*` | No | SMS notifications only |
| `FOLLOWUP_HOURS` | No | Re-check interval for stale packages (default 24) |
| `DATA_DIR` | No | Persistence path (`/data` with Railway volume) |