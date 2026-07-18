# Git setup & push to GitHub

This file explains how to push the project to a GitHub repo from Codespaces.

## One-time setup (only the first time)

```bash
# 1) Make sure git knows who you are
git config --global user.name "Your Name"
git config --global user.email "your-email@example.com"

# 2) If this folder isn't already a git repo, init it
cd /workspaces/FIN  # or wherever the project lives
git init
git branch -M main

# 3) Connect to your GitHub repo (replace the URL with yours)
git remote add origin https://github.com/<your-username>/<your-repo>.git

# 4) If your repo already has content, pull it first
git pull origin main --rebase
```

## Push the project

```bash
# Stage everything
git add .

# See what will be committed
git status

# Commit
git commit -m "feat: Arabic financial review system v2.0

- Multi-company isolation (data/companies/<id>/)
- Trial balance screen with inline editing (add/edit/delete)
- Validation engine with 10 checks (score 0-100)
- Four financial statements + notes + comparison
- Full Arabic support (RTL, Amiri font, digit normalization)
- Export to Excel and PDF"

# Push
git push -u origin main
```

## If push is rejected (remote has content you don't have)

```bash
# Option A: pull then push
git pull --rebase origin main
git push origin main

# Option B: force push (only if you want to overwrite the remote)
git push -f origin main
```

## Common issues

### "fatal: not a git repository"
```bash
git init
```

### "Permission denied (publickey)"
You need to either:
- Add an SSH key to GitHub (https://github.com/settings/keys), OR
- Use HTTPS URL and use a Personal Access Token as the password

### "Updates were rejected because the remote contains work that you do not have locally"
```bash
git pull --rebase origin main
git push origin main
```

## What gets pushed (and what doesn't)

The `.gitignore` file ensures these are NOT committed:
- `venv/` — your local Python virtual environment
- `data/` — per-company JSON files (each developer's own data)
- `uploads/*` — uploaded trial balance files (except `.gitkeep`)
- `outputs/*` — exported Excel/PDF reports (except `.gitkeep`)
- `__pycache__/`, `*.pyc` — Python cache files
- `.vscode/`, `.idea/` — IDE settings
- `.DS_Store` — macOS metadata

What IS committed:
- All source code (`app.py`, `core/`, `static/`, `templates/`)
- `requirements.txt`, `run.sh`, `README.md`, `.gitignore`
- `samples/sample_trial_balance.{xlsx,pdf}` — example data
- `static/fonts/Amiri-*.ttf` — Arabic font
- `preview/*.png` — UI screenshots
