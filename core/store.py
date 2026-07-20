"""
Persistent storage layer with multi-company isolation.

Each company gets its own file under data/companies/<id>/.json and its
own subdirectory data/companies/<id>/jobs/<job_id>.json.

This guarantees that data from one company NEVER appears in another.
"""

from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Optional


BASE = Path(__file__).parent.parent
DATA = BASE / "data"
COMPANIES_DIR = DATA / "companies"


# ──────────────────────────────────────────────────────────────────────────────
# Companies
# ──────────────────────────────────────────────────────────────────────────────

def _company_path(company_id: str) -> Path:
    return COMPANIES_DIR / f"{company_id}.json"


def _job_path(company_id: str, job_id: str) -> Path:
    return COMPANIES_DIR / company_id / "jobs" / f"{job_id}.json"


def list_companies() -> list[dict]:
    """Return all companies, newest first."""
    if not COMPANIES_DIR.exists():
        return []
    out = []
    for p in COMPANIES_DIR.glob("*.json"):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            out.append(_summary(data))
        except Exception:
            pass
    out.sort(key=lambda c: c.get("created_at", 0), reverse=True)
    return out


def get_company(company_id: str) -> dict:
    p = _company_path(company_id)
    if not p.exists():
        raise KeyError(f"company not found: {company_id}")
    return json.loads(p.read_text(encoding="utf-8"))


def create_company(name: str, currency: str = "ر.س", tax_id: str = "", notes: str = "") -> dict:
    company_id = uuid.uuid4().hex[:12]
    now = time.time()
    data = {
        "id": company_id,
        "name": name.strip(),
        "currency": currency.strip() or "ر.س",
        "tax_id": tax_id.strip(),
        "notes": notes.strip(),
        "created_at": now,
        "updated_at": now,
    }
    COMPANIES_DIR.mkdir(parents=True, exist_ok=True)
    (COMPANIES_DIR / company_id / "jobs").mkdir(parents=True, exist_ok=True)
    _company_path(company_id).write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return data


def update_company(company_id: str, **fields) -> dict:
    data = get_company(company_id)
    for k, v in fields.items():
        if v is not None and k in ("name", "currency", "tax_id", "notes"):
            data[k] = v
    data["updated_at"] = time.time()
    _company_path(company_id).write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return data


def delete_company(company_id: str) -> None:
    """Delete company and all its data. Irreversible."""
    import shutil
    p = COMPANIES_DIR / company_id
    if p.exists():
        shutil.rmtree(p)
    cp = _company_path(company_id)
    if cp.exists():
        cp.unlink()


def _summary(company: dict) -> dict:
    """Compact view: id, name, dates, job_count."""
    job_count = 0
    p = COMPANIES_DIR / company["id"] / "jobs"
    if p.exists():
        job_count = len(list(p.glob("*.json")))
    return {
        "id": company["id"],
        "name": company["name"],
        "currency": company.get("currency", "ر.س"),
        "tax_id": company.get("tax_id", ""),
        "notes": company.get("notes", ""),
        "created_at": company.get("created_at"),
        "updated_at": company.get("updated_at"),
        "job_count": job_count,
    }


# ──────────────────────────────────────────────────────────────────────────────
# Jobs (trial balances, scoped by company)
# ──────────────────────────────────────────────────────────────────────────────

def list_jobs(company_id: str) -> list[dict]:
    """All jobs for a company, newest first."""
    if not _company_path(company_id).exists():
        return []
    jobs_dir = COMPANIES_DIR / company_id / "jobs"
    if not jobs_dir.exists():
        return []
    out = []
    for p in jobs_dir.glob("*.json"):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            out.append({
                "job_id": data["job_id"],
                "company_id": company_id,
                "filename": data.get("filename"),
                "period": data.get("period"),
                "status": data.get("status"),
                "uploaded_at": data.get("uploaded_at"),
                "is_locked": data.get("is_locked", False),
                "account_count": len(data.get("accounts", [])),
                "balanced": _quick_balance_check(data.get("raw_rows", [])),
            })
        except Exception:
            pass
    out.sort(key=lambda j: j.get("uploaded_at", 0), reverse=True)
    return out


def get_job(company_id: str, job_id: str) -> dict:
    p = _job_path(company_id, job_id)
    if not p.exists():
        raise KeyError(f"job not found: {company_id}/{job_id}")
    return json.loads(p.read_text(encoding="utf-8"))


def save_job(company_id: str, job_data: dict) -> None:
    p = _job_path(company_id, job_data["job_id"])
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(
        json.dumps(job_data, ensure_ascii=False, default=str, indent=2),
        encoding="utf-8",
    )


def delete_job(company_id: str, job_id: str) -> None:
    p = _job_path(company_id, job_id)
    if p.exists():
        p.unlink()


def _quick_balance_check(rows: list[dict]) -> bool:
    """Returns True if total debit == total credit in the raw rows."""
    if not rows:
        return None
    try:
        t = sum((float(r.get("debit", 0) or 0) - float(r.get("credit", 0) or 0))
                for r in rows)
        return abs(t) < 0.01
    except Exception:
        return None


# ──────────────────────────────────────────────────────────────────────────────
# Account Profile
# ──────────────────────────────────────────────────────────────────────────────

def _profile_path(company_id):
    return COMPANIES_DIR / company_id / "profile.json"


def get_profile(company_id):
    p = _profile_path(company_id)
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except:
        return {}


def save_profile(company_id, profile):
    p = _profile_path(company_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(profile, ensure_ascii=False, indent=2), encoding="utf-8")
