"""
FastAPI backend — multi-company financial review system.

Endpoints are scoped by X-Company-Id header (or ?company_id= query param).
A "current company" is the company whose data the UI is showing.
"""

from __future__ import annotations

import re
import json
import os
import time
import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from core import store
from core.account_classifier import Account, AccountClassifier, sub_category_options
from core.file_parsers import parse_file
from core.financial_statements import (
    build_balance_sheet, build_income_statement,
    build_cash_flow, build_equity_statement,
    Statement, StatementLine,
)
from core.notes_generator import build_notes, attach_note_refs, Note
from core.comparator import compare_statements, compare_accounts, kpis
from core.exporters import export_excel, export_pdf, export_comparison_excel
from core.validator import validate_trial_balance


# ──────────────────────────────────────────────────────────────────────────────
# App setup
# ──────────────────────────────────────────────────────────────────────────────

BASE = Path(__file__).parent
DATA_DIR = BASE / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
# IMPORTANT: keep uploads/outputs inside data/ so they persist on Render's persistent disk
UPLOAD_DIR = DATA_DIR / "uploads"
OUTPUT_DIR = DATA_DIR / "outputs"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="نظام المراجعة المالية", version="2.0")
app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def _company_id(
    x_company_id: Optional[str] = Header(None),
    company_id: Optional[str] = Query(None),
) -> str:
    """Extract the company id from header or query."""
    cid = x_company_id or company_id
    if not cid:
        raise HTTPException(400, "يجب تحديد الشركة (X-Company-Id header أو ?company_id=)")
    # Confirm the company exists
    try:
        store.get_company(cid)
    except KeyError:
        raise HTTPException(404, f"الشركة غير موجودة: {cid}")
    return cid


def _load_job_scoped(company_id: str, job_id: str) -> dict:
    try:
        return store.get_job(company_id, job_id)
    except KeyError:
        raise HTTPException(404, "الوظيفة غير موجودة")


def _rebuild_statements(accounts: list[Account], company: dict, period: str) -> dict:
    currency = company.get("currency", "ر.س")
    bs = build_balance_sheet(accounts, period=period, currency=currency)
    inc = build_income_statement(accounts, period=period, currency=currency)
    cf = build_cash_flow(accounts, period=period, currency=currency)
    eq = build_equity_statement(accounts, period=period, currency=currency)
    return {
        "balance_sheet": bs,
        "income_statement": inc,
        "cash_flow": cf,
        "equity": eq,
    }


# ──────────────────────────────────────────────────────────────────────────────
# UI
# ──────────────────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
def home():
    with open(BASE / "templates" / "index.html", "r", encoding="utf-8") as f:
        return HTMLResponse(f.read())


# ──────────────────────────────────────────────────────────────────────────────
# Companies
# ──────────────────────────────────────────────────────────────────────────────

@app.get("/api/companies")
def get_companies():
    return {"companies": store.list_companies()}


@app.post("/api/companies")
def create_company(payload: dict):
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "اسم الشركة مطلوب")
    c = store.create_company(
        name=name,
        currency=payload.get("currency", "ر.س"),
        tax_id=payload.get("tax_id", ""),
        notes=payload.get("notes", ""),
    )
    return c


@app.get("/api/companies/{company_id}")
def get_company_detail(company_id: str):
    try:
        c = store.get_company(company_id)
    except KeyError:
        raise HTTPException(404, "الشركة غير موجودة")
    return c


@app.put("/api/companies/{company_id}")
def update_company(company_id: str, payload: dict):
    try:
        return store.update_company(company_id, **payload)
    except KeyError:
        raise HTTPException(404, "الشركة غير موجودة")


@app.delete("/api/companies/{company_id}")
def delete_company(company_id: str):
    try:
        store.delete_company(company_id)
    except KeyError:
        raise HTTPException(404, "الشركة غير موجودة")
    return {"ok": True}


@app.get("/api/companies/{company_id}/profile")
def get_company_profile(company_id: str):
    try:
        store.get_company(company_id)
    except KeyError:
        raise HTTPException(404, "الشركة غير موجودة")
    profile = store.get_profile(company_id)
    return {"company_id": company_id, "profile": profile, "count": len(profile)}


@app.post("/api/companies/{company_id}/save-profile")
def save_company_profile(company_id: str, payload: dict = None):
    try:
        store.get_company(company_id)
    except KeyError:
        raise HTTPException(404, "الشركة غير موجودة")
    payload = payload or {}
    new_profile = None
    if "profile" in payload and isinstance(payload["profile"], dict):
        new_profile = payload["profile"]
    elif "job_id" in payload:
        try:
            job = store.get_job(company_id, payload["job_id"])
        except KeyError:
            raise HTTPException(404, "الوظيفة غير موجودة")
        new_profile = {}
        for a in job.get("accounts", []):
            code = (a.get("code") or "").strip()
            sub = a.get("sub_category")
            if code and sub and sub != "unspecified":
                new_profile[code] = sub
    else:
        raise HTTPException(400, "يجب إرسال job_id أو profile")
    existing = store.get_profile(company_id)
    existing.update(new_profile)
    store.save_profile(company_id, existing)
    return {"ok": True, "company_id": company_id, "count": len(existing)}


# ──────────────────────────────────────────────────────────────────────────────
# Account Profile (saved classifications per company)
# ──────────────────────────────────────────────────────────────────────────────

@app.get("/api/companies/{company_id}/profile")
def get_company_profile(company_id: str):
    """Return the saved account classifications for this company."""
    try:
        store.get_company(company_id)
    except KeyError:
        raise HTTPException(404, "الشركة غير موجودة")
    profile = store.get_profile(company_id)
    return {"company_id": company_id, "profile": profile, "count": len(profile)}


@app.post("/api/companies/{company_id}/save-profile")
def save_company_profile(company_id: str, payload: dict = None):
    """Save all current account classifications from a job as the company profile.

    Body: {"job_id": "<job_id>"}
    Or:   {"profile": {"1101": "cash", "1102": "bank", ...}}
    """
    try:
        store.get_company(company_id)
    except KeyError:
        raise HTTPException(404, "الشركة غير موجودة")

    payload = payload or {}
    new_profile = None
    if "profile" in payload and isinstance(payload["profile"], dict):
        new_profile = payload["profile"]
    elif "job_id" in payload:
        try:
            job = store.get_job(company_id, payload["job_id"])
        except KeyError:
            raise HTTPException(404, "الوظيفة غير موجودة")
        new_profile = {}
        for a in job.get("accounts", []):
            code = (a.get("code") or "").strip()
            sub = a.get("sub_category")
            if code and sub and sub != "unspecified":
                new_profile[code] = sub
    else:
        raise HTTPException(400, "يجب إرسال job_id أو profile")

    existing = store.get_profile(company_id)
    existing.update(new_profile)
    store.save_profile(company_id, existing)
    return {"ok": True, "company_id": company_id, "count": len(existing), "profile": existing}


# ──────────────────────────────────────────────────────────────────────────────
# Jobs (trial balances) — all scoped by company
# ──────────────────────────────────────────────────────────────────────────────

@app.get("/api/jobs")
def list_jobs(company_id: str = Query(...)):
    return {"jobs": store.list_jobs(company_id)}


@app.post("/api/upload")
async def upload(
    file: UploadFile = File(...),
    company_id: str = Query(...),
    period: str = Form(""),
):
    # Validate company
    try:
        company = store.get_company(company_id)
    except KeyError:
        raise HTTPException(404, "الشركة غير موجودة")

    ext = Path(file.filename).suffix.lower()
    if ext not in (".xlsx", ".xls", ".xlsm", ".pdf", ".csv"):
        raise HTTPException(400, f"نوع الملف غير مدعوم: {ext}")

    job_id = uuid.uuid4().hex[:12]
    safe_name = f"{job_id}{ext}"
    out_path = UPLOAD_DIR / safe_name
    content = await file.read()
    out_path.write_bytes(content)

    try:
        rows = parse_file(str(out_path))
    except Exception as e:
        raise HTTPException(400, f"فشل قراءة الملف: {e}")

    if not rows:
        raise HTTPException(400, "لم يتم استخراج أي صفوف من الملف")

    job_data = {
        "job_id": job_id,
        "company_id": company_id,
        "filename": file.filename,
        "saved_as": safe_name,
        "period": period or "الفترة الحالية",
        "currency": company.get("currency", "ر.س"),
        "uploaded_at": time.time(),
        "status": "uploaded",
        "is_locked": False,
        "raw_rows": rows,
        "accounts": [],
        "statements": None,
        "notes": None,
    }
    store.save_job(company_id, job_data)

    return {
        "job_id": job_id,
        "company_id": company_id,
        "filename": file.filename,
        "rows_parsed": len(rows),
        "rows": rows,
        "sub_categories": sub_category_options(),
    }


@app.post("/api/process/{job_id}")
def process(
    job_id: str,
    company_id: str = Query(...),
    company_name: Optional[str] = None,
    period: Optional[str] = None,
    currency: Optional[str] = None,
):
    job = _load_job_scoped(company_id, job_id)
    rows = job["raw_rows"]

    if not rows:
        raise HTTPException(400, "لا توجد بيانات لتجهيزها")

    # Load saved profile for this company (if any) and apply BEFORE classification
    profile = store.get_profile(company_id)

    clf = AccountClassifier()
    accounts = []
    for r in rows:
        a = clf.classify(r.get("code", ""), r.get("name", ""), r.get("debit", 0), r.get("credit", 0))
        if r.get("sub_category"):
            a.sub_category = r["sub_category"]
        accounts.append(a)

    period = period or job.get("period", "")
    company = store.get_company(company_id)
    currency = currency or company.get("currency", "ر.س")

    statements = _rebuild_statements(accounts, company, period)
    notes = build_notes(accounts, statements, company_name=company["name"], period=period)
    attach_note_refs(statements, notes)

    job["accounts"] = [a.to_dict() for a in accounts]
    job["statements"] = {k: s.to_dict() for k, s in statements.items()}
    job["notes"] = [n.to_dict() for n in notes]
    job["status"] = "ready"
    job["period"] = period
    job["currency"] = currency
    store.save_job(company_id, job)

    return {
        "job_id": job_id,
        "company_id": company_id,
        "status": "ready",
        "company": company["name"],
        "period": period,
        "totals": {k: s.totals for k, s in statements.items()},
        "statement_count": len(statements),
        "note_count": len(notes),
        "accounts": [a.to_dict() for a in accounts],
    }


@app.get("/api/jobs/{job_id}")
def get_job_full(job_id: str, company_id: str = Query(...)):
    job = _load_job_scoped(company_id, job_id)
    return job


@app.delete("/api/jobs/{job_id}")
def delete_job(job_id: str, company_id: str = Query(...)):
    try:
        store.delete_job(company_id, job_id)
    except Exception:
        raise HTTPException(404, "الوظيفة غير موجودة")
    return {"ok": True}


@app.post("/api/jobs/{job_id}/commit")
def commit_job(job_id: str, company_id: str = Query(...)):
    """Mark a draft job as committed (saved) so it appears in the main list."""
    job = _load_job_scoped(company_id, job_id)
    if job.get("status") in ("committed", "ready", "processed"):
        return {"ok": True, "job_id": job_id, "status": job["status"]}
    # need at least the statements to be considered "committed"
    if not job.get("statements"):
        # auto-process to generate statements
        try:
            process(job_id, company_id=company_id)
        except HTTPException:
            pass
    job = _load_job_scoped(company_id, job_id)
    job["status"] = "committed"
    job["is_locked"] = True
    job["committed_at"] = time.time()
    store.save_job(company_id, job)
    return {"ok": True, "job_id": job_id, "status": "committed"}


# ──────────────────────────────────────────────────────────────────────────────
# Accounts (editing trial balance)
# ──────────────────────────────────────────────────────────────────────────────

@app.put("/api/jobs/{job_id}/accounts/{idx}")
def update_account(
    job_id: str,
    idx: int,
    payload: dict,
    company_id: str = Query(...),
):
    """Update a single account by index. Re-runs classification & rebuilds statements."""
    job = _load_job_scoped(company_id, job_id)
    if job.get("is_locked"):
        raise HTTPException(403, "ميزان المراجعة مقفل — احذف القفل أولاً")

    raw_rows = job.get("raw_rows", [])
    if idx < 0 or idx >= len(raw_rows):
        raise HTTPException(404, f"الحساب رقم {idx} غير موجود")

    r = raw_rows[idx]
    # Update the row fields
    for k in ("code", "name", "debit", "credit"):
        if k in payload:
            r[k] = payload[k]
    # Save
    store.save_job(company_id, job)

    # Rebuild accounts & statements
    job["status"] = "uploaded"
    job["accounts"] = []
    job["statements"] = None
    store.save_job(company_id, job)

    # Auto-reprocess so the user sees fresh statements
    return process(job_id, company_id=company_id)


@app.post("/api/jobs/{job_id}/accounts")
def add_account(
    job_id: str,
    payload: dict,
    company_id: str = Query(...),
):
    """Append a new account row to the trial balance."""
    job = _load_job_scoped(company_id, job_id)
    if job.get("is_locked"):
        raise HTTPException(403, "ميزان المراجعة مقفل")

    raw_rows = job.get("raw_rows", [])
    raw_rows.append({
        "code": (payload.get("code") or "").strip(),
        "name": (payload.get("name") or "").strip(),
        "debit": float(payload.get("debit") or 0),
        "credit": float(payload.get("credit") or 0),
    })
    store.save_job(company_id, job)

    # Auto-reprocess
    return process(job_id, company_id=company_id)


@app.delete("/api/jobs/{job_id}/accounts/{idx}")
def delete_account(
    job_id: str,
    idx: int,
    company_id: str = Query(...),
):
    """Delete an account row."""
    job = _load_job_scoped(company_id, job_id)
    if job.get("is_locked"):
        raise HTTPException(403, "ميزان المراجعة مقفل")

    raw_rows = job.get("raw_rows", [])
    if idx < 0 or idx >= len(raw_rows):
        raise HTTPException(404, "الحساب غير موجود")
    raw_rows.pop(idx)
    store.save_job(company_id, job)
    return process(job_id, company_id=company_id)


@app.post("/api/jobs/{job_id}/reclassify")
def reclassify(
    job_id: str,
    payload: dict,
    company_id: str = Query(...),
):
    """Change a single account's category (without changing amounts)."""
    job = _load_job_scoped(company_id, job_id)
    if job.get("is_locked"):
        raise HTTPException(403, "ميزان المراجعة مقفل")

    new_sub = payload.get("new_sub")
    if not new_sub:
        raise HTTPException(400, "يجب تحديد new_sub")

    target_idx = payload.get("index")
    target_code = (payload.get("code") or "").strip()
    target_name = (payload.get("name") or "").strip()

    if not job.get("accounts"):
        raise HTTPException(400, "لم يتم تجهيز القوائم بعد")

    from core.account_classifier import Account as Acc
    accs: list[Acc] = [Acc(**a) for a in job["accounts"]]
    matched = False
    if target_idx is not None:
        try:
            i = int(target_idx)
            if 0 <= i < len(accs):
                AccountClassifier.reclassify(accs[i], new_sub)
                raw_rows = job.get("raw_rows", [])
                if 0 <= i < len(raw_rows):
                    raw_rows[i]["sub_category"] = new_sub
                    job["raw_rows"] = raw_rows
                matched = True
        except (ValueError, TypeError):
            pass
    if not matched:
        for a in accs:
            if (target_code and a.code == target_code) or (target_name and a.name == target_name):
                AccountClassifier.reclassify(a, new_sub)
                matched = True
                break
    if not matched:
        raise HTTPException(404, "لم يتم العثور على الحساب")

    period = job.get("period", "")
    company = store.get_company(company_id)
    currency = job.get("currency") or company.get("currency", "ر.س")
    statements = _rebuild_statements(accs, company, period)
    notes = build_notes(accs, statements, company_name=company["name"], period=period)
    attach_note_refs(statements, notes)

    job["accounts"] = [a.to_dict() for a in accs]
    job["statements"] = {k: s.to_dict() for k, s in statements.items()}
    job["notes"] = [n.to_dict() for n in notes]
    store.save_job(company_id, job)

    return {
        "ok": True,
        "job_id": job_id,
        "totals": {k: s.totals for k, s in statements.items()},
        "statements": job["statements"],
        "notes": job["notes"],
    }


# ──────────────────────────────────────────────────────────────────────────────
# Validation
# ──────────────────────────────────────────────────────────────────────────────

@app.get("/api/jobs/{job_id}/validate")
def validate_job(job_id: str, company_id: str = Query(...)):
    job = _load_job_scoped(company_id, job_id)
    if not job.get("accounts"):
        raise HTTPException(400, "لم يتم تجهيز القوائم بعد")

    from core.account_classifier import Account as Acc
    accs = [Acc(**a) for a in job["accounts"]]
    statements = None
    if job.get("statements"):
        statements = {}
        for k, v in job["statements"].items():
            statements[k] = v.get("totals", {})

    report = validate_trial_balance(accs, statements)
    return report.to_dict()


# ──────────────────────────────────────────────────────────────────────────────
# Statements / Notes
# ──────────────────────────────────────────────────────────────────────────────

@app.get("/api/statements/{job_id}")
def get_statements(job_id: str, company_id: str = Query(...)):
    job = _load_job_scoped(company_id, job_id)
    if not job.get("statements"):
        raise HTTPException(400, "لم يتم تجهيز القوائم بعد")
    return {
        "job_id": job_id,
        "company_id": company_id,
        "company": store.get_company(company_id).get("name"),
        "period": job.get("period"),
        "currency": job.get("currency"),
        "statements": job["statements"],
        "totals": {k: s["totals"] for k, s in job["statements"].items()},
        "notes": job.get("notes", []),
    }


@app.get("/api/notes/{job_id}")
def get_notes(job_id: str, company_id: str = Query(...)):
    job = _load_job_scoped(company_id, job_id)
    return {"notes": job.get("notes", [])}


# ──────────────────────────────────────────────────────────────────────────────
# Exports
# ──────────────────────────────────────────────────────────────────────────────

@app.get("/api/export/{fmt}/{job_id}")
def export(fmt: str, job_id: str, company_id: str = Query(...)):
    job = _load_job_scoped(company_id, job_id)
    if not job.get("statements"):
        raise HTTPException(400, "لم يتم تجهيز القوائم بعد")

    fmt = fmt.lower()
    if fmt not in ("xlsx", "excel", "pdf"):
        raise HTTPException(400, "صيغة التصدير غير مدعومة")

    period = job.get("period", "")
    company = store.get_company(company_id)
    company_name = company.get("name", "الشركة")
    currency = job.get("currency") or company.get("currency", "ر.س")

    statements = {}
    for k, v in job["statements"].items():
        v = dict(v)
        v["lines"] = [StatementLine(**ln) for ln in v.get("lines", [])]
        statements[k] = Statement(**v)
    notes = [Note(**n) for n in job.get("notes", [])]

    safe_company = re.sub(r"[^\w\u0600-\u06FF_-]", "_", company_name)[:40] or "company"

    if fmt in ("xlsx", "excel"):
        out = OUTPUT_DIR / f"{job_id}.xlsx"
        path = export_excel(statements, notes, str(out), company_name, period)
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        filename = f"{safe_company}_{period}.xlsx"
    else:
        out = OUTPUT_DIR / f"{job_id}.pdf"
        path = export_pdf(statements, notes, str(out), company_name, period)
        media = "application/pdf"
        filename = f"{safe_company}_{period}.pdf"

    return FileResponse(path, media_type=media, filename=filename)


# ──────────────────────────────────────────────────────────────────────────────
# Comparison
# ──────────────────────────────────────────────────────────────────────────────

@app.post("/api/compare")
def compare(payload: dict):
    job_c = store.get_job(payload["company_current"], payload["job_current"])
    job_p = store.get_job(payload["company_prior"], payload["job_prior"])

    stmts_c = {}
    for k, v in job_c["statements"].items():
        v = dict(v); v["lines"] = [StatementLine(**ln) for ln in v.get("lines", [])]
        stmts_c[k] = Statement(**v)
    stmts_p = {}
    for k, v in job_p["statements"].items():
        v = dict(v); v["lines"] = [StatementLine(**ln) for ln in v.get("lines", [])]
        stmts_p[k] = Statement(**v)

    out = {}
    for key in stmts_c:
        if key in stmts_p:
            comp = compare_statements(stmts_c[key], stmts_p[key])
            out[key] = [c.to_dict() for c in comp]

    ks = kpis(stmts_c.get("balance_sheet", stmts_c["balance_sheet"]),
              stmts_p["balance_sheet"])

    from core.account_classifier import Account as Acc
    accts_c = [Acc(**a) for a in job_c["accounts"]]
    accts_p = [Acc(**a) for a in job_p["accounts"]]
    movements = compare_accounts(accts_c, accts_p)

    return {"ok": True, "kpis": ks, "comparisons": out, "movements": movements}


# ──────────────────────────────────────────────────────────────────────────────
# Bootstrap
# ──────────────────────────────────────────────────────────────────────────────

@app.get("/api/load_sample")
def load_sample(company_id: str = Query(...)):
    """Bootstrap a sample trial balance for the current company."""
    sample_path = BASE / "samples" / "sample_trial_balance.xlsx"
    if not sample_path.exists():
        raise HTTPException(404, "ملف العينة غير موجود")

    job_id = uuid.uuid4().hex[:12]
    saved = UPLOAD_DIR / f"{job_id}.xlsx"
    saved.write_bytes(sample_path.read_bytes())
    rows = parse_file(str(saved))

    period = "السنة المنتهية في 31 ديسمبر 2024"
    job_data = {
        "job_id": job_id,
        "company_id": company_id,
        "filename": "sample_trial_balance.xlsx",
        "saved_as": saved.name,
        "period": period,
        "uploaded_at": time.time(),
        "status": "uploaded",
        "is_locked": False,
        "raw_rows": rows,
        "accounts": [],
        "statements": None,
        "notes": None,
    }
    store.save_job(company_id, job_data)
    return {"job_id": job_id, "company_id": company_id, "rows_parsed": len(rows)}


@app.post("/api/load_demo")
def load_demo():
    """Bootstrap a demo company with sample data — convenient for first-time use."""
    existing = [c for c in store.list_companies() if c["name"] == "شركة المثال"]
    if existing:
        c = store.get_company(existing[0]["id"])
    else:
        c = create_company({"name": "شركة المثال", "currency": "ر.س"})
    return c


# ──────────────────────────────────────────────────────────────────────────────
# Run
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")


def _build_notes_comparison_rows(current_notes: list, previous_notes: list) -> list[dict]:
    """
    Build a flat list of rows for "الإيضاحات - مقارنة" sheet.
    Each note generates TWO rows: current period then previous period, sharing the same serial number.
    Columns: رقم | الإيضاح | الفترة | الرصيد | الوصف | الحسابات
    """
    rows = []
    prev_map = {n.get("title", ""): n for n in (previous_notes or [])}
    # build list of all unique titles, preserving current order
    titles = []
    seen = set()
    for n in (current_notes or []):
        t = n.get("title", "")
        if t and t not in seen:
            seen.add(t); titles.append(t)
    for n in (previous_notes or []):
        t = n.get("title", "")
        if t and t not in seen:
            seen.add(t); titles.append(t)

    def _note_total(n):
        if not n: return 0
        for row in (n.get("table") or []):
            if "الرصيد" in str(row.get("label", "")):
                return row.get("amount", 0) or 0
        tbl = n.get("table") or []
        if tbl: return tbl[0].get("amount", 0) or 0
        return sum((a.get("amount", 0) or 0) for a in (n.get("accounts") or []))

    def _note_body(n):
        return (n.get("body") or "") if n else ""

    def _note_accounts_text(n):
        if not n: return ""
        parts = []
        for a in (n.get("accounts") or []):
            code = a.get("code", "")
            name = a.get("name", "")
            amt = a.get("amount", 0) or 0
            parts.append(f"{code} - {name}: {amt:,.0f}")
        return " | ".join(parts)

    for idx, title in enumerate(titles, 1):
        cn = next((n for n in (current_notes or []) if n.get("title") == title), None)
        pn = prev_map.get(title)
        rows.append({
            "num": idx,
            "title": title,
            "period": "الفترة الحالية",
            "total": _note_total(cn),
            "body": _note_body(cn),
            "accounts": _note_accounts_text(cn),
        })
        rows.append({
            "num": idx,
            "title": title,
            "period": "الفترة السابقة",
            "total": _note_total(pn) if pn else 0,
            "body": _note_body(pn),
            "accounts": _note_accounts_text(pn),
        })
    return rows




def _build_detailed_notes_for_comparison(current_notes, previous_notes, selected_titles=None):
    """
    بناء الإيضاحات المفصّلة للمقارنة بين فترتين.
    selected_titles: إذا تم تمريره، نُبقي فقط الإيضاحات اللي عنوانها فيه (None = الكل)
    """
    selected_set = set(selected_titles) if selected_titles else None
    prev_map = {n.get("title", ""): n for n in (previous_notes or [])}
    titles = []
    seen = set()
    for n in (current_notes or []):
        t = n.get("title", "")
        if t and t not in seen:
            seen.add(t); titles.append(t)
    for n in (previous_notes or []):
        t = n.get("title", "")
        if t and t not in seen:
            seen.add(t); titles.append(t)

    def _total(n):
        if not n: return 0
        for row in (n.get("table") or []):
            if "الرصيد" in str(row.get("label", "")):
                return row.get("amount", 0) or 0
        tbl = n.get("table") or []
        if tbl: return tbl[0].get("amount", 0) or 0
        return sum((a.get("amount", 0) or 0) for a in (n.get("accounts") or []))

    notes_out = []
    out_idx = 0
    for idx, title in enumerate(titles, 1):
        # فلتر: إذا في selected_set، نتجاهل العناوين غير الموجودة
        if selected_set is not None and title not in selected_set:
            continue
        cn = next((n for n in (current_notes or []) if n.get("title") == title), None)
        pn = prev_map.get(title)
        cur_total = _total(cn)
        prev_total = _total(pn) if pn else 0
        out_idx += 1
        notes_out.append({
            "number": out_idx,
            "title": title,
            "body": (cn or {}).get("body", "") or (pn or {}).get("body", ""),
            "current_accounts": (cn or {}).get("accounts", []) or [],
            "previous_accounts": (pn or {}).get("accounts", []) or [],
            "current_total": cur_total,
            "previous_total": prev_total,
            "diff": cur_total - prev_total,
        })
    return notes_out

def _build_comparison_data(current_job, previous_job):
    """تحويل jobs إلى structure يطابق توقيع export_comparison_excel الأصلي + الإيضاحات."""
    cur_stmts = current_job.get("statements", {}) or {}
    prev_stmts = previous_job.get("statements", {}) or {}
    
    all_keys = list(dict.fromkeys(list(cur_stmts.keys()) + list(prev_stmts.keys())))
    
    comparisons = {}
    for key in all_keys:
        cur_stmt = cur_stmts.get(key, {}) or {}
        prev_stmt = prev_stmts.get(key, {}) or {}
        prev_map = {l.get("label", ""): l.get("amount", 0) for l in (prev_stmt.get("lines") or [])}
        
        rows = []
        for line in (cur_stmt.get("lines") or []):
            label = line.get("label", "")
            cur_amt = line.get("amount", 0) or 0
            prev_amt = prev_map.get(label, 0) or 0
            rows.append({
                "label": label,
                "current": cur_amt,
                "prior": prev_amt,
                "bold": line.get("bold", False),
                "indent": line.get("indent", 0),
            })
        if rows:
            comparisons[key] = rows
    
    # إيضاحات المقارنة
    cur_notes = current_job.get("notes", []) or []
    prev_notes = previous_job.get("notes", []) or []
    prev_note_map = {n.get("title", ""): n for n in prev_notes}
    all_note_titles = list(dict.fromkeys(
        [n.get("title", "") for n in cur_notes] +
        [n.get("title", "") for n in prev_notes]
    ))
    note_rows = []
    for title in all_note_titles:
        cn = next((n for n in cur_notes if n.get("title", "") == title), None)
        pn = prev_note_map.get(title)
        # الرصيد الكلي من table أو مجموع accounts
        def _total(n):
            if not n: return 0
            tbl = n.get("table") or []
            if tbl:
                # أول صف "الرصيد في نهاية الفترة"
                for row in tbl:
                    if "الرصيد" in str(row.get("label", "")):
                        return row.get("amount", 0) or 0
                return tbl[0].get("amount", 0) or 0
            accs = n.get("accounts") or []
            return sum((a.get("amount", 0) or 0) for a in accs)
        note_rows.append({
            "label": title,
            "current": _total(cn),
            "prior": _total(pn) if pn else 0,
        })
    if note_rows:
        comparisons["__notes__"] = note_rows
    
    kpis = []
    cur_totals = current_job.get("totals", {}) or {}
    prev_totals = previous_job.get("totals", {}) or {}
    if cur_totals or prev_totals:
        for tk, ar in [("assets", ["total_assets"]), ("liabilities", ["total_liabilities"]),
                       ("equity", ["total_equity"]), ("income", ["net_income", "revenue"])]:
            for k in ar:
                cv = (cur_totals.get(tk) or {}).get(k)
                pv = (prev_totals.get(tk) or {}).get(k)
                if cv is not None or pv is not None:
                    kpis.append({"name": f"{tk}.{k}", "current": cv or 0, "prior": pv or 0})
    
    return comparisons, kpis


@app.post("/api/compare/export/{fmt}")
def export_comparison(fmt: str, payload: dict):
    """Export comparison of two jobs to Excel (3 أعمدة)."""
    from fastapi.responses import FileResponse
    import tempfile, os
    from core.exporters import export_comparison_excel as _exp_comp
    
    if fmt != "xlsx":
        raise HTTPException(400, "تنسيق غير مدعوم. استخدم xlsx")
    
    current_id = payload.get("current_job_id")
    previous_id = payload.get("previous_job_id")
    company_id = payload.get("company_id") or _company_id(x_company_id=None, company_id=None)
    
    if not current_id or not previous_id:
        raise HTTPException(400, "يجب تحديد current_job_id و previous_job_id")
    
    try:
        current_job = store.get_job(company_id, current_id)
        previous_job = store.get_job(company_id, previous_id)
    except KeyError as e:
        raise HTTPException(404, f"وظيفة غير موجودة: {e}")
    
    company = store.get_company(company_id)
    company_name = company.get("name", "الشركة") if company else "الشركة"
    period_current = current_job.get("period", "الحالية")
    period_prior = previous_job.get("period", "السابقة")
    
    comparisons, kpis = _build_comparison_data(current_job, previous_job)
    selected_titles = payload.get("selected_titles")  # list of note titles to include; None = all
    detailed_full = _build_detailed_notes_for_comparison(
        current_job.get("notes", []), previous_job.get("notes", []),
        selected_titles=selected_titles
    )
    out_path = os.path.join(tempfile.gettempdir(), f"comparison_{current_id}_{previous_id}.xlsx")
    _exp_comp(comparisons, kpis, out_path, company_name, period_current, period_prior)
    # بعد التوليد، أضف ورقة "الإيضاحات المرفقة" المفصّلة
    from openpyxl import load_workbook as _lwb
    from core.exporters import export_notes_comparison_sheet as _notes_sheet
    _wbk = _lwb(out_path)
    _notes_sheet(_wbk, detailed_full, period_current, period_prior)
    _wbk.save(out_path)
    
    fname = f"comparison_{period_current}_vs_{period_prior}.xlsx"
    return FileResponse(
        out_path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=fname
    )


# ──────────────────────────────────────────────────────────────────────────────
# Consolidation Engine (IFRS 10) — Group APIs
# ──────────────────────────────────────────────────────────────────────────────

from core.consolidation import consolidate, export_consolidated_excel


@app.get("/api/groups")
def list_groups():
    return {"groups": store.list_groups()}


@app.post("/api/groups")
def create_group(payload: dict):
    name = (payload.get("name") or "").strip()
    parent_id = payload.get("parent_company_id")
    if not name:
        raise HTTPException(400, "اسم المجموعة مطلوب")
    if not parent_id:
        raise HTTPException(400, "يجب تحديد الشركة الأم")
    try:
        store.get_company(parent_id)
    except KeyError:
        raise HTTPException(404, "الشركة الأم غير موجودة")
    g = store.create_group(name, parent_id, payload.get("notes", ""))
    return g


@app.get("/api/groups/{group_id}")
def get_group_detail(group_id: str):
    try:
        g = store.get_group(group_id)
    except KeyError:
        raise HTTPException(404, "مجموعة غير موجودة")
    # enrich with company names
    links = []
    for l in g.get("links", []):
        try:
            c = store.get_company(l["company_id"])
            l["company_name"] = c.get("name", "")
        except KeyError:
            l["company_name"] = "(محذوفة)"
        links.append(l)
    g["links"] = links
    return g


@app.post("/api/groups/{group_id}/add-company")
def add_company(group_id: str, payload: dict):
    company_id = payload.get("company_id")
    pct = float(payload.get("ownership_pct", 0))
    method = payload.get("consolidation_method", "full")
    if not company_id or pct < 0 or pct > 100:
        raise HTTPException(400, "بيانات غير صحيحة")
    try:
        store.get_company(company_id)
    except KeyError:
        raise HTTPException(404, "شركة غير موجودة")
    return store.add_company_to_group(group_id, company_id, pct, method)


@app.post("/api/groups/{group_id}/remove-company")
def remove_company(group_id: str, payload: dict):
    company_id = payload.get("company_id")
    if not company_id:
        raise HTTPException(400, "company_id مطلوب")
    return store.remove_company_from_group(group_id, company_id)


@app.delete("/api/groups/{group_id}")
def delete_group(group_id: str):
    try:
        store.delete_group(group_id)
    except Exception as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


@app.post("/api/groups/{group_id}/consolidate")
def consolidate_group(group_id: str, payload: dict):
    """
    Build the consolidated statements for a group.

    payload: {
      "job_ids": {"<company_id>": "<job_id>", ...},   # one parsed job per company
      "company_id": "<owner_company_id_for_data_path>"
    }
    If a company has no job_id, the latest saved job is used automatically.
    """
    from fastapi.responses import JSONResponse
    try:
        group = store.get_group(group_id)
    except KeyError:
        raise HTTPException(404, "مجموعة غير موجودة")
    company_id_path = payload.get("company_id") or group.get("parent_company_id")
    job_ids_map = payload.get("job_ids") or {}

    jobs_data = []
    for link in group.get("links", []):
        cid = link["company_id"]
        try:
            company = store.get_company(cid)
        except KeyError:
            continue
        # pick the job: explicit then latest
        jid = job_ids_map.get(cid)
        if not jid:
            jobs_list = store.list_jobs(cid) or []
            saved = [j for j in jobs_list if j.get("status") in ("ready", "committed", "processed")]
            if not saved:
                continue
            jid = saved[0]["job_id"]
        try:
            job = store.get_job(cid, jid)
        except KeyError:
            continue
        if not job.get("statements"):
            continue
        job["company_id"] = cid
        job["company_name"] = company.get("name", "")
        jobs_data.append(job)

    if not jobs_data:
        raise HTTPException(400, "لا توجد ميزانيات محفوظة لشركات المجموعة")

    # enrich group dict with parent company name
    try:
        parent_co = store.get_company(group["parent_company_id"])
        group["parent_company_name"] = parent_co.get("name", "")
    except KeyError:
        group["parent_company_name"] = ""

    consolidated = consolidate(group, group.get("links", []), jobs_data)
    # Add job_ids used
    consolidated["job_ids_used"] = {j["company_id"]: j.get("job_id") for j in jobs_data}
    return JSONResponse(content=consolidated)


@app.post("/api/groups/{group_id}/export/xlsx")
def export_group_xlsx(group_id: str, payload: dict):
    """Export consolidated statements to Excel."""
    from fastapi.responses import FileResponse
    import tempfile
    try:
        group = store.get_group(group_id)
    except KeyError:
        raise HTTPException(404, "مجموعة غير موجودة")
    job_ids_map = payload.get("job_ids") or {}
    jobs_data = []
    for link in group.get("links", []):
        cid = link["company_id"]
        try:
            company = store.get_company(cid)
        except KeyError:
            continue
        jid = job_ids_map.get(cid)
        if not jid:
            jobs_list = store.list_jobs(cid) or []
            saved = [j for j in jobs_list if j.get("status") in ("ready", "committed", "processed")]
            if not saved:
                continue
            jid = saved[0]["job_id"]
        try:
            job = store.get_job(cid, jid)
        except KeyError:
            continue
        if not job.get("statements"):
            continue
        job["company_id"] = cid
        job["company_name"] = company.get("name", "")
        jobs_data.append(job)
    if not jobs_data:
        raise HTTPException(400, "لا توجد ميزانيات محفوظة")
    try:
        parent_co = store.get_company(group["parent_company_id"])
        group["parent_company_name"] = parent_co.get("name", "")
    except KeyError:
        group["parent_company_name"] = ""
    consolidated = consolidate(group, group.get("links", []), jobs_data)
    out_path = os.path.join(tempfile.gettempdir(), f"consolidated_{group_id}.xlsx")
    export_consolidated_excel(consolidated, out_path)
    return FileResponse(
        out_path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=f"consolidated_{group.get('name', group_id)}.xlsx",
    )


# ──────────────────────────────────────────────────────────────────────────────
# Advanced Intercompany Eliminations Engine
# ──────────────────────────────────────────────────────────────────────────────

from core.eliminations import (
    detect_ic_transactions,
    pair_transactions,
    apply_eliminations as apply_adv_eliminations,
    export_eliminations_to_excel,
    generate_journal_entries,
)


def _load_group_jobs_data(group_id: str, job_ids_map: dict) -> list[dict]:
    """Helper: build jobs_data list for a group."""
    try:
        group = store.get_group(group_id)
    except KeyError:
        raise HTTPException(404, "مجموعة غير موجودة")
    jobs_data = []
    for link in group.get("links", []):
        cid = link["company_id"]
        try:
            company = store.get_company(cid)
        except KeyError:
            continue
        jid = (job_ids_map or {}).get(cid)
        if not jid:
            jobs_list = store.list_jobs(cid) or []
            saved = [j for j in jobs_list if j.get("status") in ("ready", "committed", "processed")]
            if not saved:
                continue
            jid = saved[0]["job_id"]
        try:
            job = store.get_job(cid, jid)
        except KeyError:
            continue
        if not job.get("statements"):
            continue
        job["company_id"] = cid
        job["company_name"] = company.get("name", "")
        jobs_data.append(job)
    return group, jobs_data


@app.post("/api/groups/{group_id}/detect-eliminations")
def detect_group_eliminations(group_id: str, payload: dict):
    """
    Auto-detect intercompany transactions across the group and pair them.
    Returns: {
      transactions: [...],
      summary: { ic_receivable: 25000, ic_payable: 25000, ... },
      matched_count: 2,
      unmatched_count: 0
    }
    """
    job_ids_map = payload.get("job_ids") or {}
    try:
        group, jobs_data = _load_group_jobs_data(group_id, job_ids_map)
    except HTTPException:
        raise
    if not jobs_data:
        raise HTTPException(400, "لا توجد ميزانيات محفوظة لشركات المجموعة")
    transactions = detect_ic_transactions(jobs_data)
    paired = pair_transactions(transactions)
    summary = {}
    for tx in paired:
        cat = tx.get("sub_category", "")
        if tx.get("matched"):
            summary[cat] = summary.get(cat, 0) + tx["amount"]
    matched_count = sum(1 for tx in paired if tx.get("matched"))
    return {
        "group_id": group_id,
        "group_name": group.get("name", ""),
        "transactions": paired,
        "summary": summary,
        "matched_count": matched_count,
        "unmatched_count": len(paired) - matched_count,
        "total_transactions": len(paired),
    }


@app.post("/api/groups/{group_id}/apply-eliminations")
def apply_group_eliminations(group_id: str, payload: dict):
    """
    Apply approved eliminations and re-run consolidation.
    payload: { job_ids: {...}, transaction_ids: [list of tx ids to apply] }
    """
    from fastapi.responses import JSONResponse
    job_ids_map = payload.get("job_ids") or {}
    tx_ids = set(payload.get("transaction_ids") or [])
    try:
        group, jobs_data = _load_group_jobs_data(group_id, job_ids_map)
    except HTTPException:
        raise
    if not jobs_data:
        raise HTTPException(400, "لا توجد ميزانيات محفوظة")
    # Re-detect and pair
    transactions = detect_ic_transactions(jobs_data)
    paired = pair_transactions(transactions)
    # Filter to only approved
    if tx_ids:
        filtered = [tx for tx in paired if tx["id"] in tx_ids or tx.get("matched_with") in tx_ids]
    else:
        filtered = [tx for tx in paired if tx.get("matched")]
    # Run consolidation
    try:
        parent_co = store.get_company(group["parent_company_id"])
        group["parent_company_name"] = parent_co.get("name", "")
    except KeyError:
        group["parent_company_name"] = ""
    consolidated = consolidate(group, group.get("links", []), jobs_data)
    # Apply advanced eliminations
    consolidated = apply_adv_eliminations(consolidated, filtered)
    # NCI
    total_equity = _get_company_amount(jobs_data, "balance_sheet", "حقوق الملكية")
    # Use the eliminated equity from consolidated
    for line in (consolidated["statements"].get("balance_sheet", {}).get("lines") or []):
        if "حقوق الملكية" in (line.get("label") or "") and line.get("bold"):
            total_equity = float(line.get("amount", 0) or 0)
            break
    nci_info = compute_nci(total_equity, consolidated.get("avg_ownership_pct", 0))
    consolidated["nci"] = nci_info
    consolidated["elimination_journal"] = generate_journal_entries(
        [{"sub_category": tx["sub_category"], "amount": tx["amount"]} for tx in filtered]
    )
    consolidated["applied_eliminations"] = [
        {
            "id": tx["id"],
            "company": tx.get("company_name", ""),
            "account": tx.get("account_name", ""),
            "category": IC_CATEGORY_MAP.get(tx.get("sub_category", ""), {}).get("ar", ""),
            "amount": tx["amount"],
            "matched_with": tx.get("matched_with"),
            "diff": tx.get("diff", 0),
        }
        for tx in filtered
    ]
    return JSONResponse(content=consolidated)


@app.post("/api/groups/{group_id}/export/eliminations")
def export_group_eliminations(group_id: str, payload: dict):
    """Export detected eliminations to Excel."""
    from fastapi.responses import FileResponse
    import tempfile
    job_ids_map = payload.get("job_ids") or {}
    try:
        group, jobs_data = _load_group_jobs_data(group_id, job_ids_map)
    except HTTPException:
        raise
    if not jobs_data:
        raise HTTPException(400, "لا توجد ميزانيات محفوظة")
    transactions = detect_ic_transactions(jobs_data)
    paired = pair_transactions(transactions)
    out_path = os.path.join(tempfile.gettempdir(), f"eliminations_{group_id}.xlsx")
    export_eliminations_to_excel(paired, out_path, group.get("name", "مجموعة"))
    return FileResponse(
        out_path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=f"eliminations_{group.get('name', group_id)}.xlsx",
    )


@app.post("/api/groups/{group_id}/add-manual-elimination")
def add_manual_elimination(group_id: str, payload: dict):
    """
    Add a manual intercompany elimination that the user defines.
    payload: {
      from_company_id, to_company_id, account_label,
      amount, sub_category, description
    }
    """
    from fastapi.responses import JSONResponse
    job_ids_map = payload.get("job_ids") or {}
    try:
        group, jobs_data = _load_group_jobs_data(group_id, job_ids_map)
    except HTTPException:
        raise
    if not jobs_data:
        raise HTTPException(400, "لا توجد ميزانيات")
    cat = payload.get("sub_category", "ic_receivable")
    if cat not in IC_CATEGORY_MAP:
        raise HTTPException(400, "نوع غير معروف")
    amount = float(payload.get("amount", 0))
    if amount <= 0:
        raise HTTPException(400, "المبلغ يجب أن يكون أكبر من صفر")
    transactions = detect_ic_transactions(jobs_data)
    # Add the manual entry as a virtual transaction on both sides
    manual_tx_id = f"tx_manual_{cat}_{payload.get('from_company_id', 'x')}_{payload.get('to_company_id', 'y')}"
    from_co = next((j for j in jobs_data if j["company_id"] == payload.get("from_company_id")), None)
    to_co = next((j for j in jobs_data if j["company_id"] == payload.get("to_company_id")), None)
    if not from_co or not to_co:
        raise HTTPException(400, "الشركات غير موجودة في المجموعة")
    transactions.append({
        "id": manual_tx_id + "_from",
        "company_id": from_co["company_id"],
        "company_name": from_co["company_name"],
        "account_code": payload.get("account_code", ""),
        "account_name": payload.get("account_label", ""),
        "sub_category": cat,
        "kind": IC_CATEGORY_MAP[cat]["kind"],
        "amount": amount,
        "is_debit": True,
        "matched": True,
        "matched_with": manual_tx_id + "_to",
        "diff": 0.0,
    })
    complement = PAIRING_RULES.get(cat)
    if complement:
        transactions.append({
            "id": manual_tx_id + "_to",
            "company_id": to_co["company_id"],
            "company_name": to_co["company_name"],
            "account_code": payload.get("account_code", ""),
            "account_name": payload.get("account_label", ""),
            "sub_category": complement,
            "kind": IC_CATEGORY_MAP[complement]["kind"],
            "amount": amount,
            "is_debit": True,
            "matched": True,
            "matched_with": manual_tx_id + "_from",
            "diff": 0.0,
        })
    return JSONResponse(content={"transactions": transactions, "ok": True})


# ===== فتح الميزان للتعديل (Unlock for editing) =====
@app.post("/api/jobs/{job_id}/unlock")
def unlock_job(job_id, company_id=Query(...)):
    """فتح ميزان محفوظ لتعديل التصنيفات"""
    job = _load_job_scoped(company_id, job_id)
    if not job:
        raise HTTPException(404, "الميزان غير موجود")
    job["is_locked"] = False
    job["status"] = "uploaded"
    store.save_job(company_id, job)
    return {"ok": True, "job_id": job_id, "status": "uploaded", "message": "تم فتح الميزان للتعديل"}
