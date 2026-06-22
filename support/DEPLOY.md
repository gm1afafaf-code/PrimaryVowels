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
   - `FEDEX_ENV` = `sandbox`
4. Click **Deploy**
5. Open your Vercel URL (e.g. `https://primary-vowels-abc.vercel.app`) — tracking works there immediately

## Optional: use primaryvowels.com/support URL

If you want the tracker at your domain instead of `vercel.app`:

- In Vercel → Settings → Domains → add `support.primaryvowels.com`
- Add the DNS record Vercel gives you
- Update the homepage nav link to point there

No `config.js`. No `PV_API_URL`. When UI and API are on the same Vercel deploy, it just works.