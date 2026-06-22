# Password Protection

The entire site is now protected with HTTP Basic Authentication.

## Credentials
- **Username**: `admin`
- **Password**: `nimda`

## How it works
- `middleware.js` is a Vercel Edge Middleware that runs on **every request**.
- It checks the `Authorization` header for valid Basic Auth credentials.
- Invalid or missing credentials return a `401 Unauthorized` with `WWW-Authenticate`.

## Deployment Requirements

**This only works when the site is deployed to Vercel.**

1. Deploy (or re-deploy) this repository to **Vercel** (use the root of the repo).
2. Vercel will automatically use:
   - `middleware.js` for authentication
   - `vercel.json` for routing + function configuration
3. Point your custom domain `primaryvowels.com` (and www if used) to this Vercel project.
4. **Disable** any previous GitHub Pages deployment for the domain, otherwise the protection won't apply.

## What gets protected
- All static pages (`/`, `/tracking/`, `/support/`, `/service/`)
- All images and assets
- The FedEx API endpoints (`/support/api/track`, `/support/api/health`)

## Notes
- Browsers will show a native username/password dialog.
- Once logged in, credentials are usually cached by the browser for the session.
- This is simple Basic Auth — fine for internal/preview use. Not a replacement for proper user accounts.

## If you still have a separate support Vercel project
The API base URL was changed to prefer relative calls. If you continue using a separate project for the API, you can revert `FEDEX_API_BASE` in `support/app.js` to the old external URL and add similar middleware protection there as well.
