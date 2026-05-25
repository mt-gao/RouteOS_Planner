# RouteOS Cloudflare Deployment

RouteOS deploys as one Cloudflare Worker:

- Vite static assets are served from `dist/`.
- `/api/*` runs in `worker/index.ts`.
- The browser uses the same public domain for UI, AMap JS, route planning, and AI chat.

## Required Secrets

Set these in Cloudflare before production deploy:

```bash
npx wrangler secret put AMAP_KEY
npx wrangler secret put AMAP_JS_KEY
npx wrangler secret put AMAP_SECURITY_JS_CODE
```

Set one model key if AI chat should work for all users:

```bash
npx wrangler secret put MODEL_API_KEY
```

`wrangler.toml` already sets:

- `MODEL_BASE_URL=https://api.deepseek.com`
- `MODEL_NAME=deepseek-v4-flash`
- `DEEPSEEK_REASONING_EFFORT=max`

## Local Cloudflare Test

Create `.dev.vars` locally:

```dotenv
AMAP_KEY="..."
AMAP_JS_KEY="..."
AMAP_SECURITY_JS_CODE="..."
MODEL_API_KEY="..."
```

Then run:

```bash
npm run dev:cf
```

## Deploy

```bash
npm run deploy
```

After deployment, open:

```text
https://routeos.<your-subdomain>.workers.dev
```

Check:

```text
/api/health
```

It should return `runtime: "cloudflare-worker"`, `hasAmapKey: true`, and `hasModelKey: true`.
