"""
FastAPI backend — exposes the financial review system over HTTP.

Endpoints:
  GET  /                        — HTML dashboard
  POST /api/upload              — upload trial balance (Excel/PDF/CSV)
  POST /api/process             — process the latest upload into statements
  GET  /api/statements/{id}     — fetch the 4 statements for a job
  GET  /api/notes/{id}          — fetch the notes for a job
  POST /api/reclassify          — change a single account's category
  POST /api/export/{fmt}/{id}   — export Excel or PDF
  POST /api/compare             — build a side-by-side comparison
  POST /api/compare/export      — export comparison as Excel or PDF
  GET  /api/jobs                — list jobs (for the dashboard cards)
"""

from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from core.account_classifier import AccountClassifier, sub_category_options
from core.file_parsers import parse_file
from core.financial_statements import (
    build_balance_sheet, build_income_statement,
    build_cash_flow, build_equity_statement,
)
from core.notes_generator import build_notes, attach_note_refs
from core.comparator import compare_statements, compare_accounts, kpis
from core.exporters import export_excel, export_pdf, export_comparison_excel


# ──────────────────────────────────────────────────────────────────────────────
# App setup
# ──────────────────────────────────────────────────────────────────────────────

BASE = Path(__file__).parent
UPLOAD_DIR = BASE / "uploads"
OUTPUT_DIR = BASE / "outputs"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="نظام المراجعة المالية", version="1.0")
app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")
templates = Jinja2Templates(directory=str(BASE / "templates"))


# ──────────────────────────────────────────────────────────────────────────────
# Job store — in-memory; persists JSON files on disk
# ──────────────────────────────────────────────────────────────────────────────

JOBS: dict[str, dict] = {}


def _save_job(job_id: str) -> None:
    """Persist a job to disk so it survives restarts."""
    p = OUTPUT_DIR / f"{job_id}.json"
    p.write_text(json.dumps(JOBS[job_id], ensure_ascii=False, default=str), encoding="utf-8")


def _load_job(job_id: str) -> dict:
    if job_id in JOBS:
        return JOBS[job_id]
    p = OUTPUT_DIR / f"{job_id}.json"
    if not p.exists():
        raise HTTPException(404, "الوظيفة غير موجودة")
    data = json.loads(p.read_text(encoding="utf-8"))
    JOBS[job_id] = data
    return data


# ──────────────────────────────────────────────────────────────────────────────
# Routes — UI
# ──────────────────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
def home():
    with open(BASE / "templates" / "index.html", "r", encoding="utf-8") as f:
        return HTMLResponse(f.read())


# ──────────────────────────────────────────────────────────────────────────────
# Routes — API
# ──────────────────────────────────────────────────────────────────────────────

@app.post("/api/upload")
async def upload(file: UploadFile = File(...), period: str = Form("")):
    """Save the trial balance file to disk and return a job_id."""
    ext = Path(file.filename).suffix.lower()
    if ext not in (".xlsx", ".xls", ".xlsm", ".pdf", ".csv"):
        raise HTTPException(400, f"نوع الملف غير مدعوم: {ext}")

    job_id = uuid.uuid4().hex[:12]
    safe_name = f"{job_id}{ext}"
    out_path = UPLOAD_DIR / safe_name
    content = await file.read()
    out_path.write_bytes(content)

    # Try to parse immediately so the user can preview the raw rows
    try:
        rows = parse_file(str(out_path))
    except Exception as e:
        raise HTTPException(400, f"فشل قراءة الملف: {e}")

    JOBS[job_id] = {
        "job_id": job_id,
        "filename": file.filename,
        "saved_as": safe_name,
        "period": period or "الفترة الحالية",
        "uploaded_at": time.time(),
        "status": "uploaded",
        "raw_rows": rows,
        "accounts": [],
        "statements": None,
        "notes": None,
    }
    _save_job(job_id)

    return {
        "job_id": job_id,
        "filename": file.filename,
        "rows_parsed": len(rows),
        "rows": rows,
        "sub_categories": sub_category_options(),
    }


@app.post("/api/process/{job_id}")
def process(job_id: str, company_name: str = "الشركة", period: str = "", currency: str = "ر.س"):
    """Classify accounts and build the 4 statements + notes."""
    job = _load_job(job_id)
    rows = job["raw_rows"]

    if not rows:
        raise HTTPException(400, "لا توجد بيانات لتجهيزها. تأكد من رفع ملف صحيح.")

    clf = AccountClassifier()
    accounts = [
        clf.classify(r.get("code", ""), r.get("name", ""), r.get("debit", 0), r.get("credit", 0))
        for r in rows
    ]

    period = period or job.get("period", "")
    as_of = period

    bs = build_balance_sheet(accounts, as_of=as_of, period=period, currency=currency)
    inc = build_income_statement(accounts, period=period, currency=currency)
    cf = build_cash_flow(accounts, period=period, currency=currency)
    eq = build_equity_statement(accounts, period=period, currency=currency)

    statements = {
        "balance_sheet": bs,
        "income_statement": inc,
        "cash_flow": cf,
        "equity": eq,
    }
    notes = build_notes(accounts, statements, company_name=company_name, period=period)
    attach_note_refs(statements, notes)

    job["accounts"] = [a.to_dict() for a in accounts]
    job["statements"] = {k: s.to_dict() for k, s in statements.items()}
    job["notes"] = [n.to_dict() for n in notes]
    job["company_name"] = company_name
    job["currency"] = currency
    job["status"] = "ready"
    _save_job(job_id)

    return {
        "job_id": job_id,
        "status": "ready",
        "company": company_name,
        "period": period,
        "totals": {k: s.totals for k, s in statements.items()},
        "statement_count": len(statements),
        "note_count": len(notes),
        "accounts": [a.to_dict() for a in accounts],
    }


@app.get("/api/jobs")
def list_jobs():
    out = []
    for job_id, j in JOBS.items():
        out.append({
            "job_id": job_id,
            "filename": j.get("filename"),
            "period": j.get("period"),
            "status": j.get("status"),
            "uploaded_at": j.get("uploaded_at"),
            "accounts": len(j.get("accounts", [])),
        })
    # also include persisted jobs
    for p in OUTPUT_DIR.glob("*.json"):
        if p.stem not in JOBS:
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                out.append({
                    "job_id": p.stem,
                    "filename": data.get("filename"),
                    "period": data.get("period"),
                    "status": data.get("status"),
                    "uploaded_at": data.get("uploaded_at"),
                    "accounts": len(data.get("accounts", [])),
                })
            except Exception:
                pass
    out.sort(key=lambda x: x.get("uploaded_at", 0), reverse=True)
    return {"jobs": out}


@app.get("/api/statements/{job_id}")
def get_statements(job_id: str):
    job = _load_job(job_id)
    if not job.get("statements"):
        raise HTTPException(400, "لم يتم تجهيز القوائم بعد. استدعي /api/process أولاً.")
    return {
        "job_id": job_id,
        "company": job.get("company_name"),
        "period": job.get("period"),
        "currency": job.get("currency"),
        "statements": job["statements"],
        "totals": {k: s["totals"] for k, s in job["statements"].items()},
    }


@app.get("/api/notes/{job_id}")
def get_notes(job_id: str):
    job = _load_job(job_id)
    return {
        "job_id": job_id,
        "notes": job.get("notes", []),
    }


@app.post("/api/reclassify/{job_id}")
def reclassify(job_id: str, payload: dict):
    """
    Change a single account's sub_category and rebuild the statements.
    Body: {"code": "1101", "name": "...", "new_sub": "cash_and_equivalents"}
    """
    job = _load_job(job_id)
    if not job.get("accounts"):
        raise HTTPException(400, "لم يتم تجهيز القوائم بعد")

    new_sub = payload.get("new_sub")
    if not new_sub:
        raise HTTPException(400, "يجب تحديد new_sub")

    target_code = payload.get("code", "")
    target_name = payload.get("name", "")

    from core.account_classifier import Account, AccountClassifier
    accs: list[Account] = [Account(**a) for a in job["accounts"]]
    matched = False
    for a in accs:
        if (target_code and a.code == target_code) or (target_name and a.name == target_name):
            AccountClassifier.reclassify(a, new_sub)
            matched = True
            break
    if not matched:
        raise HTTPException(404, "لم يتم العثور على الحساب")

    period = job.get("period", "")
    currency = job.get("currency", "ر.س")
    company = job.get("company_name", "الشركة")

    bs = build_balance_sheet(accs, period=period, currency=currency)
    inc = build_income_statement(accs, period=period, currency=currency)
    cf = build_cash_flow(accs, period=period, currency=currency)
    eq = build_equity_statement(accs, period=period, currency=currency)
    statements = {"balance_sheet": bs, "income_statement": inc, "cash_flow": cf, "equity": eq}
    notes = build_notes(accs, statements, company_name=company, period=period)
    attach_note_refs(statements, notes)

    job["accounts"] = [a.to_dict() for a in accs]
    job["statements"] = {k: s.to_dict() for k, s in statements.items()}
    job["notes"] = [n.to_dict() for n in notes]
    _save_job(job_id)

    return {
        "ok": True,
        "job_id": job_id,
        "totals": {k: s.totals for k, s in statements.items()},
        "statements": job["statements"],
        "notes": job["notes"],
    }


@app.get("/api/export/{fmt}/{job_id}")
def export(fmt: str, job_id: str):
    """Export the statements + notes to Excel or PDF."""
    job = _load_job(job_id)
    if not job.get("statements"):
        raise HTTPException(400, "لم يتم تجهيز القوائم بعد")

    fmt = fmt.lower()
    if fmt not in ("xlsx", "excel", "pdf"):
        raise HTTPException(400, "صيغة التصدير غير مدعومة")

    period = job.get("period", "")
    company = job.get("company_name", "الشركة")

    from core.financial_statements import Statement, StatementLine
    from core.notes_generator import Note
    statements = {}
    for k, v in job["statements"].items():
        v = dict(v)
        v["lines"] = [StatementLine(**ln) for ln in v.get("lines", [])]
        statements[k] = Statement(**v)
    notes = []
    for n in job.get("notes", []):
        n = dict(n)
        n["accounts"] = n.get("accounts", [])
        notes.append(Note(**n))

    if fmt in ("xlsx", "excel"):
        out = OUTPUT_DIR / f"{job_id}.xlsx"
        path = export_excel(statements, notes, str(out), company, period)
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        filename = f"{company}_{period}.xlsx"
    else:
        out = OUTPUT_DIR / f"{job_id}.pdf"
        path = export_pdf(statements, notes, str(out), company, period)
        media = "application/pdf"
        filename = f"{company}_{period}.pdf"

    return FileResponse(path, media_type=media, filename=filename)


# ──────────────────────────────────────────────────────────────────────────────
# Comparison endpoints
# ──────────────────────────────────────────────────────────────────────────────

@app.post("/api/compare")
def compare(payload: dict):
    """
    Compare two jobs.
    Body: {"job_current": "...", "job_prior": "...", "company": "...",
           "period_current": "...", "period_prior": "..."}
    """
    job_c = _load_job(payload["job_current"])
    job_p = _load_job(payload["job_prior"])

    from core.financial_statements import Statement, StatementLine
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

    # Also a per-account movement table
    from core.account_classifier import Account
    accts_c = [Account(**a) for a in job_c["accounts"]]
    accts_p = [Account(**a) for a in job_p["accounts"]]
    movements = compare_accounts(accts_c, accts_p)

    return {
        "ok": True,
        "kpis": ks,
        "comparisons": out,
        "movements": movements,
    }


@app.get("/api/compare/export/{fmt}")
def export_comparison_get(fmt: str, job_current: str, job_prior: str,
                          company: str = "الشركة", period_current: str = "", period_prior: str = ""):
    return export_comparison_impl(fmt, job_current, job_prior, company, period_current, period_prior)


@app.post("/api/compare/export/{fmt}")
def export_comparison(fmt: str, payload: dict):
    """Export comparison as Excel or PDF. Payload: {job_current, job_prior, company, period_current, period_prior}."""
    return export_comparison_impl(
        fmt,
        payload.get("job_current", ""),
        payload.get("job_prior", ""),
        payload.get("company", "الشركة"),
        payload.get("period_current", ""),
        payload.get("period_prior", ""),
    )


def export_comparison_impl(fmt, job_current, job_prior, company, period_current, period_prior):
    """Export the comparison result as Excel or PDF."""
    job_c = _load_job(job_current)
    job_p = _load_job(job_prior)

    from core.financial_statements import Statement, StatementLine
    stmts_c = {}
    for k, v in job_c["statements"].items():
        v = dict(v); v["lines"] = [StatementLine(**ln) for ln in v.get("lines", [])]
        stmts_c[k] = Statement(**v)
    stmts_p = {}
    for k, v in job_p["statements"].items():
        v = dict(v); v["lines"] = [StatementLine(**ln) for ln in v.get("lines", [])]
        stmts_p[k] = Statement(**v)

    comps = {}
    for key in stmts_c:
        if key in stmts_p:
            comps[key] = [c.to_dict() for c in compare_statements(stmts_c[key], stmts_p[key])]

    ks = kpis(stmts_c.get("balance_sheet", stmts_c["balance_sheet"]),
              stmts_p["balance_sheet"])

    fmt = fmt.lower()
    out_id = uuid.uuid4().hex[:8]
    if fmt in ("xlsx", "excel"):
        out = OUTPUT_DIR / f"compare_{out_id}.xlsx"
        path = export_comparison_excel(comps, ks, str(out), company, period_current, period_prior)
        return FileResponse(path, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                            filename=f"comparison_{period_current}_vs_{period_prior}.xlsx")

    # PDF comparison
    out = OUTPUT_DIR / f"compare_{out_id}.pdf"
    _export_comparison_pdf(comps, ks, str(out), company, period_current, period_prior)
    return FileResponse(out, media_type="application/pdf",
                        filename=f"comparison_{period_current}_vs_{period_prior}.pdf")


def _export_comparison_pdf(comps, ks, out_path, company, p_cur, p_pr):
    """Simple PDF export for the comparison."""
    from core.exporters import _register_fonts, _ARABIC_FONT_NAME, _ARABIC_FONT_BOLD
    from reportlab.lib.pagesizes import A4
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib import colors
    from reportlab.lib.units import cm
    from core.arabic_utils import ar, fmt_amount

    _register_fonts()

    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(str(out), pagesize=A4,
                            rightMargin=2*cm, leftMargin=2*cm,
                            topMargin=2*cm, bottomMargin=2*cm)

    styles = {
        "t": ParagraphStyle("T", fontName=_ARABIC_FONT_BOLD, fontSize=22, alignment=2, leading=30),
        "s": ParagraphStyle("S", fontName=_ARABIC_FONT_NAME, fontSize=12, alignment=2, textColor=colors.HexColor("#475569"), leading=18),
        "h": ParagraphStyle("H", fontName=_ARABIC_FONT_BOLD, fontSize=16, alignment=2, leading=22, spaceAfter=10),
        "cell": ParagraphStyle("C", fontName=_ARABIC_FONT_NAME, fontSize=10, alignment=2, leading=14),
    }

    story = []
    story.append(Paragraph(ar(company), styles["t"]))
    story.append(Paragraph(ar(f"مقارنة: {p_pr} ←→ {p_cur}"), styles["s"]))
    story.append(Spacer(1, 1*cm))

    story.append(Paragraph(ar("المؤشرات الرئيسية"), styles["h"]))
    kpi_data = [[ar("المؤشر"), ar("الفترة الحالية"), ar("الفترة السابقة"), ar("التغير"), ar("نسبة %")]]
    for k in ks:
        kpi_data.append([
            ar(k["name"]),
            ar(fmt_amount(k["current"])),
            ar(fmt_amount(k["prior"])),
            ar(fmt_amount(k["change"])),
            ar(f"{k['pct_change']*100:.1f}%") if k.get("pct_change") is not None else "—",
        ])
    t = Table(kpi_data, colWidths=[6*cm, 3*cm, 3*cm, 3*cm, 2*cm])
    t.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
        ("FONT", (0, 0), (-1, 0), _ARABIC_FONT_BOLD, 10),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F172A")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CBD5E1")),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(t)
    story.append(Spacer(1, 0.6*cm))

    titles = {
        "balance_sheet": "المركز المالي - مقارنة",
        "income_statement": "الدخل - مقارنة",
        "cash_flow": "التدفقات النقدية - مقارنة",
        "equity": "حقوق الملكية - مقارنة",
    }
    for key, rows in comps.items():
        story.append(PageBreak())
        story.append(Paragraph(ar(titles.get(key, key)), styles["h"]))
        data = [[ar("البيان"), ar("الحالية"), ar("السابقة"), ar("التغير"), ar("نسبة %")]]
        for line in rows:
            data.append([
                ar(line["label"]),
                ar(fmt_amount(line["current"])),
                ar(fmt_amount(line["prior"])),
                ar(fmt_amount(line["change"])),
                ar(f"{line['pct_change']*100:.1f}%") if line["pct_change"] is not None else "—",
            ])
        t = Table(data, colWidths=[7*cm, 3*cm, 3*cm, 2*cm, 1.5*cm])
        t.setStyle(TableStyle([
            ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
            ("FONT", (0, 0), (-1, -1), _ARABIC_FONT_NAME, 9),
            ("FONT", (0, 0), (-1, 0), _ARABIC_FONT_BOLD, 10),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F172A")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CBD5E1")),
        ]))
        story.append(t)

    doc.build(story)
    return str(out)


# ──────────────────────────────────────────────────────────────────────────────
# Bootstrap samples (only on first run)
# ──────────────────────────────────────────────────────────────────────────────

@app.get("/api/load_sample")
def load_sample():
    """Generate a balanced sample trial balance and load it as a job."""
    import openpyxl
    sample_path = BASE / "samples" / "sample_trial_balance.xlsx"
    if not sample_path.exists():
        raise HTTPException(404, "ملف العينة غير موجود")
    # Reuse upload flow
    job_id = uuid.uuid4().hex[:12]
    saved = UPLOAD_DIR / f"{job_id}.xlsx"
    saved.write_bytes(sample_path.read_bytes())
    rows = parse_file(str(saved))
    JOBS[job_id] = {
        "job_id": job_id,
        "filename": "sample_trial_balance.xlsx",
        "saved_as": saved.name,
        "period": "السنة المنتهية في 31 ديسمبر 2024",
        "uploaded_at": time.time(),
        "status": "uploaded",
        "raw_rows": rows,
        "accounts": [],
        "statements": None,
        "notes": None,
    }
    _save_job(job_id)
    return {"job_id": job_id, "rows_parsed": len(rows)}


# ──────────────────────────────────────────────────────────────────────────────
# Run
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
