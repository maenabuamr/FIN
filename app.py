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
UPLOAD_DIR = BASE / "uploads"
OUTPUT_DIR = BASE / "outputs"
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




def _build_detailed_notes_for_comparison(current_notes, previous_notes):
    """
    بناء الإيضاحات المفصّلة للمقارنة بين فترتين.
    كل إيضاح يحتوي:
      - number, title, body
      - current_accounts: list of {code, name, amount}
      - previous_accounts: list of {code, name, amount}
      - current_total, previous_total, diff
    """
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
    for idx, title in enumerate(titles, 1):
        cn = next((n for n in (current_notes or []) if n.get("title") == title), None)
        pn = prev_map.get(title)
        cur_total = _total(cn)
        prev_total = _total(pn) if pn else 0
        notes_out.append({
            "number": idx,
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
    detailed_full = _build_detailed_notes_for_comparison(
        current_job.get("notes", []), previous_job.get("notes", [])
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
