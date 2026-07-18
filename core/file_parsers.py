"""
File parsers — read trial balance from Excel, CSV, or PDF.

Returns a list of dicts: {code, name, debit, credit}

For Excel/CSV: best support, with auto header detection.
For PDF: best-effort. Works well for simple, well-structured trial-balance
PDFs (one account per line, numbers in clear columns). The system also
exposes a "manual entry" fallback in the UI.
"""

from __future__ import annotations

import csv
import re
from pathlib import Path
from typing import Optional

from .arabic_utils import clean, to_western_digits, has_arabic


# ──────────────────────────────────────────────────────────────────────────────
# Public dispatcher
# ──────────────────────────────────────────────────────────────────────────────

def parse_file(path: str) -> list[dict]:
    """Dispatch to the right parser by extension."""
    p = Path(path)
    ext = p.suffix.lower()
    if ext in (".xlsx", ".xlsm", ".xls"):
        return parse_excel(path)
    if ext == ".pdf":
        return parse_pdf(path)
    if ext == ".csv":
        return parse_csv(path)
    raise ValueError(f"نوع الملف غير مدعوم: {ext}")


# ──────────────────────────────────────────────────────────────────────────────
# Excel
# ──────────────────────────────────────────────────────────────────────────────

def parse_excel(path: str) -> list[dict]:
    from openpyxl import load_workbook

    wb = load_workbook(path, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))

    header_idx = _find_header_row(rows)
    if header_idx is None:
        raise ValueError(
            "لم يتم العثور على صف رأس الجدول في الملف. تأكد من وجود أعمدة: "
            "رمز الحساب، اسم الحساب، مدين، دائن"
        )

    header = [clean(c) for c in rows[header_idx]]
    col_map = _map_columns(header)
    if "name" not in col_map:
        raise ValueError("الملف لا يحتوي على عمود 'اسم الحساب' أو 'الحساب'")

    out: list[dict] = []
    for r in rows[header_idx + 1:]:
        if not r or all(c is None or clean(c) == "" for c in r):
            continue
        code = clean(r[col_map["code"]]) if "code" in col_map and col_map["code"] < len(r) else ""
        name = clean(r[col_map["name"]])  if "name" in col_map and col_map["name"] < len(r) else ""
        if not name:
            continue
        if name in ("الرصيد", "الإجمالي", "المجموع", "الإجمالي الكلي", "Total", ""):
            continue
        debit = _num(r[col_map["debit"]]) if "debit" in col_map and col_map["debit"] < len(r) else 0
        credit = _num(r[col_map["credit"]]) if "credit" in col_map and col_map["credit"] < len(r) else 0
        out.append({"code": code, "name": name, "debit": debit, "credit": credit})
    return out


def _find_header_row(rows: list[tuple]) -> Optional[int]:
    keys = (
        "الحساب", "اسم", "رمز", "مدين", "دائن", "رصيد",
        "Account", "Debit", "Credit", "Code", "Name",
    )
    for i, row in enumerate(rows[:20]):
        if not row:
            continue
        joined = " ".join(clean(c) for c in row if c is not None)
        if sum(1 for k in keys if k in joined) >= 3:
            return i
    return None


def _map_columns(header: list[str]) -> dict:
    mapping: dict = {}
    for i, h in enumerate(header):
        if not h:
            continue
        h_low = h.lower()
        if "code" in h_low or "رقم" in h or "رمز" in h:
            mapping.setdefault("code", i)
        elif "account" in h_low or "اسم" in h or "حساب" in h or "البيان" in h:
            mapping.setdefault("name", i)
        elif "debit" in h_low or "مدين" in h:
            mapping.setdefault("debit", i)
        elif "credit" in h_low or "دائن" in h:
            mapping.setdefault("credit", i)
        elif "balance" in h_low or "رصيد" in h:
            mapping.setdefault("balance", i)
    return mapping


def _num(v) -> float:
    if v is None or v == "":
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = to_western_digits(str(v))
    s = re.sub(r"[^\d\.\-]", "", s)
    try:
        return float(s)
    except ValueError:
        return 0.0


# ──────────────────────────────────────────────────────────────────────────────
# CSV
# ──────────────────────────────────────────────────────────────────────────────

def parse_csv(path: str) -> list[dict]:
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.reader(f)
        rows = [r for r in reader if r]
    if not rows:
        return []
    header = [clean(c) for c in rows[0]]
    col_map = _map_columns(header)
    if "name" not in col_map:
        return []
    out: list[dict] = []
    for r in rows[1:]:
        if len(r) <= col_map["name"]:
            continue
        code = clean(r[col_map["code"]]) if "code" in col_map and col_map["code"] < len(r) else ""
        name = clean(r[col_map["name"]])
        if not name or name in ("الرصيد", "الإجمالي", "المجموع", "Total"):
            continue
        debit = _num(r[col_map["debit"]]) if "debit" in col_map and col_map["debit"] < len(r) else 0
        credit = _num(r[col_map["credit"]]) if "credit" in col_map and col_map["credit"] < len(r) else 0
        out.append({"code": code, "name": name, "debit": debit, "credit": credit})
    return out


# ──────────────────────────────────────────────────────────────────────────────
# PDF — line-based extraction
# ──────────────────────────────────────────────────────────────────────────────
# Best-effort. Works for PDFs where each account appears on one line and
# numbers are in two clear columns (debit, credit).

_NUM_RE = re.compile(r"^[\(\-]?[\d\u0660-\u0669\u06F0-\u06F9,\.]+\)?$")


def parse_pdf(path: str) -> list[dict]:
    """
    Parse a trial balance from a PDF.
    Tries two strategies:
      1. `extract_tables()` to get a 2D grid (best for table PDFs).
      2. `extract_text()` line-by-line (best for line-based PDFs).
    """
    import pdfplumber

    out: list[dict] = []
    with pdfplumber.open(path) as pdf:
        # Strategy 1: table extraction
        for page in pdf.pages:
            try:
                tables = page.extract_tables() or []
                for tbl in tables:
                    if not tbl:
                        continue
                    # Try to identify the header row
                    header_idx = _find_pdf_header(tbl)
                    if header_idx is None:
                        continue
                    col_map = _map_pdf_columns(tbl[header_idx])
                    if "name" not in col_map:
                        continue
                    for r in tbl[header_idx + 1:]:
                        row = _row_from_table(r, col_map)
                        if row:
                            out.append(row)
            except Exception:
                pass

        # Strategy 2: line-based text extraction (if no rows from tables)
        if not out:
            for page in pdf.pages:
                text = page.extract_text() or ""
                for line in text.splitlines():
                    line = clean(line)
                    if not line:
                        continue
                    row = _parse_pdf_line(line)
                    if row:
                        out.append(row)
    return out


def _find_pdf_header(tbl: list[list]) -> Optional[int]:
    keys = ("الحساب", "اسم", "رمز", "مدين", "دائن", "Account", "Debit", "Credit", "Code", "Name")
    for i, row in enumerate(tbl[:5]):
        joined = " ".join((c or "") for c in row)
        if sum(1 for k in keys if k in joined) >= 2:
            return i
    return None


def _map_pdf_columns(header: list) -> dict:
    mapping: dict = {}
    for i, h in enumerate(header):
        if h is None:
            continue
        h_low = h.lower()
        if "code" in h_low or "رمز" in h or "كود" in h:
            mapping.setdefault("code", i)
        elif "account" in h_low or "اسم" in h or "حساب" in h:
            mapping.setdefault("name", i)
        elif "debit" in h_low or "مدين" in h:
            mapping.setdefault("debit", i)
        elif "credit" in h_low or "دائن" in h:
            mapping.setdefault("credit", i)
    return mapping


def _row_from_table(r: list, col_map: dict) -> Optional[dict]:
    if not r or all((c is None or clean(c) == "") for c in r):
        return None
    name = clean(r[col_map["name"]]) if "name" in col_map and col_map["name"] < len(r) else ""
    if not name or name in ("الرصيد", "الإجمالي", "المجموع", "Total"):
        return None
    code = clean(r[col_map["code"]]) if "code" in col_map and col_map["code"] < len(r) and col_map["code"] is not None else ""
    debit = _num(r[col_map["debit"]]) if "debit" in col_map and col_map["debit"] < len(r) and col_map["debit"] is not None else 0
    credit = _num(r[col_map["credit"]]) if "credit" in col_map and col_map["credit"] < len(r) and col_map["credit"] is not None else 0
    return {"code": code, "name": name, "debit": debit, "credit": credit}


def _parse_pdf_line(line: str) -> Optional[dict]:
    """
    Split a PDF text line into {code, name, debit, credit}.

    Rules:
      1. Skip header / total / page-footer lines
      2. Numbers at the right end of the line = credit, then debit
      3. First short token = code
      4. Middle tokens = name
    """
    # Skip obvious non-data lines
    skip_words = (
        "شركة", "ميزان", "إجمالي", "المجموع", "الرصيد", "صفحة",
        "إيضاح", "تقرير", "كما في", "الفترة",
    )
    if any(w in line for w in skip_words) and not _has_numbers(line):
        return None
    if "Total" in line and not _has_numbers(line):
        return None

    # Tokenize
    parts = re.split(r"\s{2,}|\t|\s(?=\d)", line)
    parts = [p for p in parts if p.strip()]

    if len(parts) < 2:
        return None

    # Pull trailing numbers (1 or 2) as debit / credit
    nums: list[float] = []
    while parts and _is_number(parts[-1]):
        nums.insert(0, _to_float(parts.pop()))
    if not nums:
        return None

    # First remaining short token = code
    if parts:
        first = parts[0]
        # If first token is short and looks like a code (digits), use it
        if re.fullmatch(r"[\d\u0660-\u0669\u06F0-\u06F9]{2,10}", to_western_digits(first)):
            code = first
            parts = parts[1:]
        else:
            code = ""
    else:
        code = ""

    name = " ".join(parts).strip()
    if not name or len(name) < 2:
        return None

    # Map numbers
    if len(nums) == 1:
        val = nums[0]
        if val >= 0:
            debit, credit = val, 0
        else:
            debit, credit = 0, -val
    else:
        debit, credit = nums[0], nums[1]

    return {"code": code, "name": name, "debit": debit, "credit": credit}


def _is_number(s: str) -> bool:
    if not s:
        return False
    s2 = to_western_digits(s)
    return bool(_NUM_RE.match(s2))


def _has_numbers(line: str) -> bool:
    return any(ch.isdigit() for ch in to_western_digits(line))


def _to_float(s: str) -> float:
    if not s:
        return 0.0
    s2 = to_western_digits(s)
    neg = s2.startswith("(") and s2.endswith(")")
    s2 = s2.strip("()")
    s2 = re.sub(r"[^\d\.]", "", s2)
    try:
        v = float(s2) if s2 else 0.0
        return -v if neg else v
    except ValueError:
        return 0.0
