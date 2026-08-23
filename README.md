# BizTrack Pro

Enterprise sales, inventory, customer, supplier and expense management.

- **API**: Cloudflare Workers (Hono + TypeScript), talking to MongoDB Atlas with the official Node driver (`nodejs_compat`) — no Data API needed (MongoDB retired that in Sept 2025).
- **Database**: MongoDB Atlas, multi-tenant (every document scoped by `businessId`).
- **Frontend**: static site (Cloudflare Pages) — see `frontend/`.
- **Auth**: business code + PIN login (matches the original CEO/Manager/Staff PIN UX), JWT bearer tokens.

## 1. Create a MongoDB Atlas cluster

1. Sign up at https://www.mongodb.com/cloud/atlas (free tier is fine to start).
2. Create a free **M0** cluster.
3. Database Access → add a database user (username + password).
4. Network Access → allow access from anywhere (`0.0.0.0/0`) since Workers don't have static IPs — Atlas Network Peering is not available on the free tier.
5. Get your connection string: Clusters → Connect → Drivers → copy the `mongodb+srv://...` URI.

## 2. Set up the Worker locally

```bash
cd worker
npm install
cp .dev.vars.example .dev.vars
# edit .dev.vars: paste your MONGODB_URI and a random JWT_SECRET
npm run dev
```

Test it:
```bash
curl http://localhost:8787/health
curl -X POST http://localhost:8787/api/auth/register-business \
  -H "Content-Type: application/json" \
  -d '{"businessName":"My Shop","ownerName":"Mohammed","pin":"1234"}'
```

## 3. Deploy the Worker to Cloudflare

```bash
cd worker
npx wrangler login
npx wrangler secret put MONGODB_URI
npx wrangler secret put JWT_SECRET
npm run deploy
```

Wrangler prints your live URL, e.g. `https://biztrack-pro-api.<you>.workers.dev`.

## 4. Push to GitHub

```bash
git remote add origin https://github.com/mohammedsamini2001-art/biztrack-pro.git
git add .
git commit -m "BizTrack Pro: Cloudflare Workers + MongoDB backend"
git branch -M main
git push -u origin main
```

## 5. (Optional) Auto-deploy on every push

The repo already includes `.github/workflows/deploy-worker.yml`. To activate it:

1. GitHub repo → Settings → Secrets and variables → Actions → New repository secret:
   - `CLOUDFLARE_API_TOKEN` (Cloudflare dashboard → My Profile → API Tokens → "Edit Cloudflare Workers" template)
   - `CLOUDFLARE_ACCOUNT_ID` (Cloudflare dashboard → right sidebar of any domain/Workers page)
2. Every push to `main` that touches `worker/` will redeploy automatically.

## 6. Deploy the frontend to Cloudflare Pages

```bash
cd frontend
npx wrangler pages deploy . --project-name=biztrack-pro
```

Then point the frontend's `API_BASE_URL` (see `frontend/config.js`) at your deployed Worker URL from step 3.

## API overview

| Endpoint | Method | Notes |
|---|---|---|
| `/api/auth/register-business` | POST | Creates business + CEO account, returns `businessCode` + token |
| `/api/auth/users?businessCode=XXXX` | GET | List login cards for the business |
| `/api/auth/login` | POST | `{businessCode, userId, pin}` → token |
| `/api/auth/users` | POST | CEO/Manager adds a Manager/Staff account |
| `/api/products` `/api/sales` `/api/customers` `/api/suppliers` `/api/services` `/api/expenses` | GET/POST/PUT/DELETE | Standard CRUD, JWT required, auto-scoped to your business |
| `/api/dashboard/summary` | GET | Aggregated stats for the dashboard |

All authenticated requests need `Authorization: Bearer <token>`.
