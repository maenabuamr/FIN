# 🚀 Render.com Deployment Guide

## Quick Deploy

1. **Push to GitHub** (already done via git push)
2. Go to https://render.com → Sign up with GitHub
3. Click **"New +"** → **"Web Service"**
4. Connect repository: `maenabuamr/FIN`
5. Render auto-detects `render.yaml`
6. Click **"Apply"**

## Files in this repo

- `render.yaml` — Render service config (web service + persistent disk)
- `Procfile` — Backup start command
- `runtime.txt` — Python version pin
- `requirements.txt` — Python dependencies

## Key Notes

### Persistent Disk
The service mounts a **1 GB persistent disk** at `/opt/render/project/src/data`. This is where:
- `data/companies/<id>.json` (company metadata)
- `data/companies/<id>/jobs/<job_id>.json` (parsed jobs)
- `data/companies/<id>/profile.json` (saved account profiles)
- `data/uploads/` (uploaded files)
- `data/outputs/` (generated PDFs / Excels)

**Important:** Files outside `data/` (e.g. the old `BASE/uploads`) are **ephemeral** and will be wiped on every restart.

### Environment Variables (auto-set by Render)
- `PORT` — the port to listen on (Render sets this; we use `$PORT` in startCommand)
- `RENDER` — `"true"` on Render

### Health Check
Render pings `GET /api/companies` every 30s to verify the service is up.

## After Deploy

1. Wait for build (~2-3 minutes)
2. Open the public URL: `https://financial-review.onrender.com`
3. **First load is slow (~30s)** because the free tier spins down after 15 min idle
4. Subsequent loads are fast while active

## Common Issues

### "No module named X"
→ Add it to `requirements.txt`, push, Render auto-rebuilds

### Uploaded files disappear after restart
→ Make sure `UPLOAD_DIR` is under `data/` (✅ fixed in latest commit)

### PORT-related errors
→ We use `uvicorn app:app --host 0.0.0.0 --port $PORT` — Render injects `$PORT` automatically

### Service stays on "Build failed"
→ Check Render logs for the exact error

## Upgrade to "Always On" ($7/mo)

The free tier **spins down after 15 min of inactivity** — first request after sleep takes ~30s.
For production use, upgrade to the **"Standard" plan ($7/mo)** which keeps the service always running.

## Custom Domain

Render supports custom domains on the free plan via CNAME.
