# Clerk Setup (Watchlyst)

## 1) Create Clerk application
1. Go to Clerk Dashboard and create an app.
2. Enable Email + Password sign in.
3. In Paths, set:
   - Sign in URL: `/signin.html`
   - Sign up URL: `/signup.html`
4. Copy keys:
   - Publishable key (`pk_...`)
   - Secret key (`sk_...`)

## 2) Configure Cloudflare Worker secrets
From `neon-worker`:

```bash
npx wrangler secret put DATABASE_URL
npx wrangler secret put CLERK_SECRET_KEY
```

Set `CORS_ORIGIN` in `wrangler.toml` to your frontend origin.

## 3) Local worker test
Create `.dev.vars` from `.dev.vars.example` and run:

```bash
npm install
npm run dev
```

Health check:

```bash
curl http://127.0.0.1:8787/health
```

## 4) Deploy
```bash
npm run deploy
```

## 5) Next step in this repo
After worker is live, wire `static-client/app.js` auth flows from Supabase to Clerk SDK + Worker API calls.
