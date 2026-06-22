# Deploy FedEx Track API (Vercel — 5 min)

## 1. FedEx credentials

1. [developer.fedex.com](https://developer.fedex.com/) → Create project → enable **Track API**
2. Copy **API Key** + **Secret Key**
3. Optional: your 9-digit **shipper account number**

## 2. Deploy to Vercel

1. [vercel.com/new](https://vercel.com/new) → Import **PrimaryVowels** from GitHub
2. **Root Directory** → `service` (click Edit)
3. **Environment Variables**:

```
FEDEX_API_KEY=your-client-id
FEDEX_API_SECRET=your-secret
FEDEX_ACCOUNT_NUMBER=123456789
FEDEX_ENV=sandbox
```

4. Deploy → copy your URL (e.g. `https://pv-fedex-tracker.vercel.app`)

## 3. Connect the frontend

Edit `service/config.js`:

```javascript
window.PV_API_URL = 'https://your-app.vercel.app';
```

Push to `main` — GitHub Pages updates in ~1 min.

## 4. Test

```bash
curl "https://your-app.vercel.app/api/health"
curl "https://your-app.vercel.app/api/track?trackingNumber=123456789012"
```

Then visit [primaryvowels.com/service/](https://www.primaryvowels.com/service/) and track `123456789012`.

## Production

Set `FEDEX_ENV=production` in Vercel env vars for real tracking numbers.