# BizTrack Pro

Enterprise sales, inventory, customer, supplier and expense management.

- **API**: Node.js server (Hono framework), deployed on Render's free tier — talks to MongoDB Atlas with the official Node driver.
- **Database**: MongoDB Atlas, multi-tenant (every document scoped by `businessId`).
- **Frontend**: static site — see `frontend/`.
- **Auth**: business code + PIN login (matches the original CEO/Manager/Staff PIN UX), JWT bearer tokens.

> This project originally targeted Cloudflare Workers, but Cloudflare's
> local dev/deploy tooling (`workerd`) doesn't run on Android/Termux, so
> it moved to a plain Node.js server on Render — same code, same
> MongoDB setup, just a different, Termux-friendly host.

## 1. MongoDB Atlas

Already covered if you followed the earlier setup — you should already have a
connection string that looks like:
```
mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
```
If not: sign up at mongodb.com/cloud/atlas, create a free M0 cluster, add a
database user, and allow network access from anywhere (`0.0.0.0/0`).

## 2. Test locally (optional)

```bash
cd server
npm install
cp .env.example .env
# edit .env: paste your MONGODB_URI and a random JWT_SECRET
npm run dev
```

```bash
curl http://localhost:3000/health
curl http://localhost:3000/debug
```

## 3. Deploy to Render (no CLI needed — works fine from Termux)

1. Push this repo to GitHub (see below if not done yet).
2. Go to https://dashboard.render.com → sign up (GitHub sign-in is fastest, no credit card required for the free tier).
3. Click **New** → **Web Service**.
4. Connect your GitHub account and select the `biztrack-pro` repo.
5. Render should detect `render.yaml` automatically. If it asks you to configure manually instead:
   - **Root Directory**: `server`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Plan**: Free
6. Under **Environment Variables**, add:
   - `MONGODB_URI` → your connection string
   - `JWT_SECRET` → any long random string
7. Click **Create Web Service**. Render will build and deploy — takes a few minutes the first time.
8. Once live, Render gives you a URL like `https://biztrack-pro-api.onrender.com`.

**Note:** the free tier spins down after 15 minutes of no traffic and takes
30-50 seconds to wake back up on the next request. That's normal — not a bug.

## 4. Push to GitHub

```bash
git add .
git commit -m "Switch backend to Node/Render (Cloudflare Workers incompatible with Termux)"
git push
```

## 5. Verify it's live

```bash
curl https://YOUR-RENDER-URL.onrender.com/health
curl https://YOUR-RENDER-URL.onrender.com/debug
curl -X POST https://YOUR-RENDER-URL.onrender.com/api/auth/register-business \
  -H "Content-Type: application/json" \
  -d '{"businessName":"Test Shop","ownerName":"Mohammed","pin":"1234"}'
```

## API overview

| Endpoint | Method | Notes |
|---|---|---|
| `/api/auth/register-business` | POST | Creates business + CEO account, returns `businessCode` + token |
| `/api/auth/users?businessCode=XXXX` | GET | List login cards for the business |
| `/api/auth/login` | POST | `{businessCode, userId, pin}` → token |
| `/api/auth/users` | POST | CEO/Manager adds a Manager/Staff account |
| `/api/products` | GET/POST/PUT/DELETE | Products with variants, images, custom fields, SKU, expiry |
| `/api/sales` `/api/customers` `/api/suppliers` `/api/services` `/api/expenses` | GET/POST/PUT/DELETE | Standard CRUD, JWT required, auto-scoped to your business |
| `/api/dashboard/summary` | GET | Aggregated stats for the dashboard |

All authenticated requests need `Authorization: Bearer <token>`.
