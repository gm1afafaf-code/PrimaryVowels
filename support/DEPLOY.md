# Make tracking work on primaryvowels.com/support

## The problem (plain English)

GitHub Pages can only serve **static files** (HTML, CSS, JS). It cannot hold your FedEx API keys safely or call the FedEx API from the server.

So there are two pieces:

| Piece | Where | What |
|-------|-------|------|
| Tracker page | GitHub Pages → `primaryvowels.com/support` | The form and scan timeline |
| FedEx API | Vercel (free) → `your-app.vercel.app` | Holds your keys, talks to FedEx |

Right now only the page is live. Tracking fails until you deploy the API half.

## Fix (2 minutes)

1. Go to [vercel.com/new](https://vercel.com/new) → import **PrimaryVowels** from GitHub
2. Set **Root Directory** to `support`
3. Add environment variables:
   - `FEDEX_API_KEY`
   - `FEDEX_API_SECRET`
   - `FEDEX_ENV` = `production` (use `sandbox` only for testing — sandbox returns the same fake shipment for every number)
4. Click **Deploy**
5. Open your Vercel URL (e.g. `https://primary-vowels-abc.vercel.app`) — tracking works there immediately

## Optional: use primaryvowels.com/support URL

If you want the tracker at your domain instead of `vercel.app`:

- In Vercel → Settings → Domains → add `support.primaryvowels.com`
- Add the DNS record Vercel gives you
- Update the homepage nav link to point there

No `config.js`. No `PV_API_URL`. When UI and API are on the same Vercel deploy, it just works.

## Get real tracking data (production)

Sandbox credentials **always return the same sample shipment** (Vancouver → Indianapolis, 2023 dates) no matter which tracking number you enter. That is expected FedEx sandbox behavior, not a bug in this app.

To look up real packages:

1. Go to [developer.fedex.com](https://developer.fedex.com/) → your project → **Move to Production** (or create a production project)
2. Ensure **Track API** is enabled for production
3. Copy the **production** Client ID and Client Secret (different from sandbox)
4. In Vercel → Settings → Environment Variables, update:
   - `FEDEX_API_KEY` = production client ID
   - `FEDEX_API_SECRET` = production client secret
   - `FEDEX_ENV` = `production`
5. Redeploy: `vercel deploy --prod` from the `support/` folder
6. Confirm `/api/health` shows `"liveData": true`