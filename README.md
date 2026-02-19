# Survey App — Deployment Guide

Two repos, two deployments:
- **`survey-backend`** → Railway (Node + SQLite API)
- **`survey-frontend`** → GitHub Pages (static HTML)

---

## 1 · Deploy the Backend to Railway

### Step 1 — Push the backend to GitHub
```bash
cd survey-backend
git init
git add .
git commit -m "initial"
git remote add origin https://github.com/YOUR_USERNAME/survey-backend.git
git push -u origin main
```

### Step 2 — Create a Railway project
1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. Click **New Project → Deploy from GitHub repo**
3. Select your `survey-backend` repository
4. Railway will auto-detect Node.js and deploy it

### Step 3 — Set environment variables in Railway
In your Railway project → **Variables**, add:

| Variable | Value |
|---|---|
| `ADMIN_PASSWORD` | a strong password of your choice |
| `ALLOWED_ORIGIN` | `https://YOUR_USERNAME.github.io` |

> `PORT` is set automatically by Railway — do not set it manually.

### Step 4 — Get your Railway URL
In Railway → **Settings → Networking**, click **Generate Domain**.
It will look like: `https://survey-backend-production-xxxx.up.railway.app`

**Copy this URL** — you need it in the next step.

---

## 2 · Configure & Deploy the Frontend to GitHub Pages

### Step 1 — Update the API URL in `index.html`
Open `survey-frontend/index.html` and replace line ~16:
```js
const API_BASE = "https://YOUR-RAILWAY-APP.up.railway.app";
```
with your actual Railway URL, e.g.:
```js
const API_BASE = "https://survey-backend-production-xxxx.up.railway.app";
```

Also update the admin password to match what you set in Railway:
```js
const ADMIN_PASSWORD = "your-strong-password";
```

### Step 2 — Push the frontend to GitHub
```bash
cd survey-frontend
git init
git add .
git commit -m "initial"
git remote add origin https://github.com/YOUR_USERNAME/survey-frontend.git
git push -u origin main
```

### Step 3 — Enable GitHub Pages
1. Go to your `survey-frontend` repo on GitHub
2. **Settings → Pages**
3. Under **Source**, select **Deploy from a branch**
4. Choose **main** branch, **/ (root)** folder
5. Click **Save**

Your site will be live at: `https://YOUR_USERNAME.github.io/survey-frontend`

---

## 3 · Verify everything works

1. Visit your GitHub Pages URL — the survey should load
2. Submit a test response
3. Click **Admin →**, enter your password, check the response appears

---

## Running locally (optional)

### Backend
```bash
cd survey-backend
npm install
node server.js
# API running at http://localhost:3001
```

### Frontend
Open `survey-frontend/index.html` in a browser, but temporarily change:
```js
const API_BASE = "http://localhost:3001";
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| CORS error in browser | Check `ALLOWED_ORIGIN` in Railway matches your GitHub Pages URL exactly (no trailing slash) |
| "Could not reach backend" | Make sure your Railway service is running (check Railway dashboard logs) |
| Admin login fails | Double-check `ADMIN_PASSWORD` env var in Railway matches `index.html` |
| Railway sleeps after inactivity | Free tier sleeps after ~30 min. Upgrade to Hobby ($5/mo) for always-on |

---

## File structure

```
survey-backend/
  server.js        ← Express + SQLite API
  package.json
  railway.toml     ← Railway deployment config
  .gitignore

survey-frontend/
  index.html       ← Full React app (survey + admin)
```
