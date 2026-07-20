#!/usr/bin/env python3
"""Fix app.py: reclassify route + profile endpoints"""
import re

with open('/workspaces/FIN/app.py', 'r') as f:
    c = f.read()

# Remove old reclassify
old = re.search(r'@app\.post\(["\']/api/jobs/\{[^}]+\}/reclassify["\']\).*?(?=@app\.|def [a-z])', c, re.DOTALL)
if old:
    c = c.replace(old.group(0), '')
    print("OK1: removed old reclassify")

# New routes
new = '''@app.post("/api/jobs/{job_id}/reclassify")
def reclassify(job_id: str, payload: dict, company_id: str = Query(...), db: Session = Depends(get_db)):
    idx = payload.get("index"); code = payload.get("code"); new_sub = payload.get("new_sub")
    if not new_sub: raise HTTPException(400, "new_sub required")
    job = db.query(Job).filter(Job.id == job_id, Job.company_id == company_id).first()
    if not job: raise HTTPException(404, "Job not found")
    accounts = job.accounts or []
    target, target_idx = None, None
    if idx is not None and 0 <= idx < len(accounts):
        target, target_idx = accounts[idx], idx
    elif code:
        for i, a in enumerate(accounts):
            if str(a.get("code", "")).strip() == str(code).strip():
                target, target_idx = a, i; break
    if not target: raise HTTPException(404, "Account not found")
    target["sub_category"] = new_sub
    job.accounts = accounts
    db.commit()
    _save_account_profile(db, company_id, target, new_sub)
    return {"ok": True, "index": target_idx, "code": target.get("code"), "new_sub": new_sub, "saved_to_profile": True}


def _save_account_profile(db, company_id, account, sub_category):
    code = str(account.get("code", "")).strip()
    if not code: return
    profile = db.query(AccountProfile).filter(AccountProfile.company_id == company_id, AccountProfile.account_code == code).first()
    if profile:
        profile.sub_category = sub_category; profile.name = account.get("name", "")
    else:
        db.add(AccountProfile(company_id=company_id, account_code=code, name=account.get("name", ""), sub_category=sub_category))
    db.commit()


@app.post("/api/companies/{company_id}/save-profile")
def save_profile_from_job(company_id: str, payload: dict, db: Session = Depends(get_db)):
    job_id = payload.get("job_id")
    job = db.query(Job).filter(Job.id == job_id, Job.company_id == company_id).first()
    if not job: raise HTTPException(404, "Job not found")
    count = 0
    for acc in (job.accounts or []):
        sub = acc.get("sub_category")
        if sub and sub != "unspecified":
            _save_account_profile(db, company_id, acc, sub); count += 1
    return {"ok": True, "saved": count}


@app.get("/api/companies/{company_id}/profile")
def get_company_profile(company_id: str, db: Session = Depends(get_db)):
    profiles = db.query(AccountProfile).filter(AccountProfile.company_id == company_id).all()
    return {"count": len(profiles), "accounts": [{"code": p.account_code, "name": p.name, "sub_category": p.sub_category} for p in profiles]}


'''
pos = c.find('@app.get')
if pos > 0:
    c = c[:pos] + new + '\n' + c[pos:]
    with open('/workspaces/FIN/app.py', 'w') as f:
        f.write(c)
    print("OK2: routes added")
else:
    print("ERROR: @app.get not found in app.py")
