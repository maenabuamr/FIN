"""
Exporters — render financial statements and notes to Excel and PDF
with full Arabic support (no broken letters, no reversed words).
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from openpyxl import Workbook
from openpyxl.styles import (
    Alignment, Border, Font, PatternFill, Side
)
from openpyxl.utils import get_column_letter
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm, mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle, PageBreak
)

from .arabic_utils import ar, fmt_amount, clean
from .financial_statements import Statement
from .notes_generator import Note


# ──────────────────────────────────────────────────────────────────────────────
# Font registration for PDF (Arabic shaping)
# ──────────────────────────────────────────────────────────────────────────────

_ARABIC_FONT_NAME = "ArabicAmiri"
_ARABIC_FONT_BOLD = "ArabicAmiri-Bold"
_ARABIC_FONT_PATH = Path(__file__).parent.parent / "static" / "fonts" / "Amiri-Regular.ttf"
_ARABIC_FONT_BOLD_PATH = Path(__file__).parent.parent / "static" / "fonts" / "Amiri-Bold.ttf"


def _register_fonts() -> None:
    """Register Amiri (free, OFL) for Arabic shaping in PDF."""
    if _ARABIC_FONT_NAME in pdfmetrics.getRegisteredFontNames():
        return
    if _ARABIC_FONT_PATH.exists():
        pdfmetrics.registerFont(TTFont(_ARABIC_FONT_NAME, str(_ARABIC_FONT_PATH)))
    else:
        pdfmetrics.registerFont(TTFont(_ARABIC_FONT_NAME, "Helvetica"))
    if _ARABIC_FONT_BOLD_PATH.exists():
        pdfmetrics.registerFont(TTFont(_ARABIC_FONT_BOLD, str(_ARABIC_FONT_BOLD_PATH)))
    else:
        pdfmetrics.registerFont(TTFont(_ARABIC_FONT_BOLD, "Helvetica-Bold"))


# ──────────────────────────────────────────────────────────────────────────────
# Excel exporter
# ──────────────────────────────────────────────────────────────────────────────

def export_excel(
    statements: dict[str, Statement],
    notes: list[Note],
    out_path: str,
    company_name: str = "الشركة",
    period: str = "",
) -> str:
    """Render all statements + notes into one .xlsx file."""
    wb = Workbook()
    # Remove default sheet
    wb.remove(wb.active)

    # ── Cover sheet
    cover = wb.create_sheet("ملخص")
    _excel_cover(cover, statements, company_name, period)

    # ── Each statement
    for key, stmt in statements.items():
        ws = wb.create_sheet(stmt.title[:31])
        _excel_statement(ws, stmt)

    # ── Notes
    if notes:
        ws = wb.create_sheet("الإيضاحات")
        _excel_notes(ws, notes)

    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    wb.save(out)
    return str(out)


def _excel_cover(ws, statements, company_name, period) -> None:
    ws["A1"] = company_name
    ws["A1"].font = Font(name="Calibri", size=20, bold=True)
    ws["A1"].alignment = Alignment(horizontal="right", readingOrder=2)
    ws.merge_cells("A1:D1")

    ws["A2"] = period
    ws["A2"].font = Font(name="Calibri", size=12, italic=True)
    ws["A2"].alignment = Alignment(horizontal="right", readingOrder=2)
    ws.merge_cells("A2:D2")

    ws["A4"] = "القوائم المالية الرئيسية"
    ws["A4"].font = Font(name="Calibri", size=14, bold=True)
    ws["A4"].alignment = Alignment(horizontal="right", readingOrder=2)
    ws.merge_cells("A4:D4")

    headers = ["القائمة", "إجمالي الأصول / الإيرادات", "صافي الربح", "التوازن"]
    for i, h in enumerate(headers, start=1):
        c = ws.cell(row=5, column=i, value=h)
        c.font = Font(name="Calibri", size=12, bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="1E293B")
        c.alignment = Alignment(horizontal="center", readingOrder=2)

    row = 6
    for key, stmt in statements.items():
        ws.cell(row=row, column=1, value=stmt.title)
        if "total_assets" in stmt.totals:
            ws.cell(row=row, column=2, value=stmt.totals["total_assets"])
        elif "total_revenue" in stmt.totals:
            ws.cell(row=row, column=2, value=stmt.totals["total_revenue"])
        ws.cell(row=row, column=3, value=stmt.totals.get("net_profit", "—"))
        ws.cell(row=row, column=4, value="✓ متوازن" if stmt.totals.get("balanced") else "—")
        for col in range(1, 5):
            ws.cell(row=row, column=col).alignment = Alignment(
                horizontal="center", readingOrder=2
            )
        row += 1

    # Column widths
    ws.column_dimensions["A"].width = 30
    ws.column_dimensions["B"].width = 24
    ws.column_dimensions["C"].width = 22
    ws.column_dimensions["D"].width = 18

    # Number format for the value cells
    for r in range(6, 6 + len(statements)):
        for col in (2, 3):
            ws.cell(row=r, column=col).number_format = "#,##0.00"


def _excel_statement(ws, stmt: Statement) -> None:
    # Title
    ws["A1"] = stmt.title
    ws["A1"].font = Font(name="Calibri", size=18, bold=True, color="0F172A")
    ws["A1"].alignment = Alignment(horizontal="center", readingOrder=2)
    ws.merge_cells("A1:C1")

    ws["A2"] = stmt.subtitle
    ws["A2"].font = Font(name="Calibri", size=10, italic=True, color="475569")
    ws["A2"].alignment = Alignment(horizontal="center", readingOrder=2)
    ws.merge_cells("A2:C2")

    ws["A3"] = stmt.as_of or stmt.period
    ws["A3"].font = Font(name="Calibri", size=10, color="475569")
    ws["A3"].alignment = Alignment(horizontal="center", readingOrder=2)
    ws.merge_cells("A3:C3")

    # Header row
    headers = ["البيان", stmt.currency, "إيضاح"]
    for i, h in enumerate(headers, start=1):
        c = ws.cell(row=5, column=i, value=h)
        c.font = Font(name="Calibri", size=12, bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="1E293B")
        c.alignment = Alignment(horizontal="center", readingOrder=2)
        c.border = _excel_border()

    thin = _excel_border()
    row = 6
    for line in stmt.lines:
        # Indent in label
        prefix = ("    " * line.indent)
        ws.cell(row=row, column=1, value=prefix + line.label)
        ws.cell(row=row, column=2, value=line.amount if abs(line.amount) > 1e-9 else "—")
        ws.cell(row=row, column=3, value=line.ref)
        # Style
        if line.is_total or line.bold:
            font = Font(name="Calibri", size=11, bold=True)
        else:
            font = Font(name="Calibri", size=11)
        for col in range(1, 4):
            cell = ws.cell(row=row, column=col)
            cell.font = font
            cell.alignment = Alignment(horizontal="center" if col == 2 else "right", readingOrder=2)
            cell.border = thin
        if line.is_subtotal or line.is_total:
            fill = PatternFill("solid", fgColor="F1F5F9")
            for col in range(1, 4):
                ws.cell(row=row, column=col).fill = fill
        # Number format
        ws.cell(row=row, column=2).number_format = '#,##0.00;(#,##0.00);"—"'
        row += 1

    # Column widths
    ws.column_dimensions["A"].width = 50
    ws.column_dimensions["B"].width = 22
    ws.column_dimensions["C"].width = 10


def _excel_notes(ws, notes: list[Note]) -> None:
    ws["A1"] = "الإيضاحات المرفقة مع القوائم المالية"
    ws["A1"].font = Font(name="Calibri", size=16, bold=True)
    ws["A1"].alignment = Alignment(horizontal="right", readingOrder=2)
    ws.merge_cells("A1:D1")

    row = 3
    for n in notes:
        ws.cell(row=row, column=1, value=f"{n.number} - {n.title}")
        ws.cell(row=row, column=1).font = Font(name="Calibri", size=14, bold=True, color="0F172A")
        ws.cell(row=row, column=1).alignment = Alignment(horizontal="right", readingOrder=2)
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=4)
        row += 1

        ws.cell(row=row, column=1, value=n.body)
        ws.cell(row=row, column=1).font = Font(name="Calibri", size=11, color="334155")
        ws.cell(row=row, column=1).alignment = Alignment(horizontal="right", readingOrder=2, wrap_text=True)
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=4)
        ws.row_dimensions[row].height = 40
        row += 1

        if n.accounts:
            # Sub-header
            for i, h in enumerate(["الحساب", "الرمز", "المبلغ", ""], start=1):
                c = ws.cell(row=row, column=i, value=h)
                c.font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
                c.fill = PatternFill("solid", fgColor="1E293B")
                c.alignment = Alignment(horizontal="center", readingOrder=2)
            row += 1
            for a in n.accounts:
                ws.cell(row=row, column=1, value=a["name"])
                ws.cell(row=row, column=2, value=a["code"])
                ws.cell(row=row, column=3, value=a["amount"] if abs(a["amount"]) > 1e-9 else "—")
                for col in range(1, 4):
                    cell = ws.cell(row=row, column=col)
                    cell.font = Font(name="Calibri", size=11)
                    cell.alignment = Alignment(horizontal="center" if col in (2, 3) else "right", readingOrder=2)
                ws.cell(row=row, column=3).number_format = '#,##0.00;(#,##0.00)'
                row += 1
            row += 1

    ws.column_dimensions["A"].width = 40
    ws.column_dimensions["B"].width = 18
    ws.column_dimensions["C"].width = 22
    ws.column_dimensions["D"].width = 10


def _excel_border() -> Border:
    side = Side(style="thin", color="CBD5E1")
    return Border(left=side, right=side, top=side, bottom=side)


# ──────────────────────────────────────────────────────────────────────────────
# PDF exporter
# ──────────────────────────────────────────────────────────────────────────────

def export_pdf(
    statements: dict[str, Statement],
    notes: list[Note],
    out_path: str,
    company_name: str = "الشركة",
    period: str = "",
) -> str:
    """Render all statements + notes into a multi-page PDF."""
    _register_fonts()

    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    doc = SimpleDocTemplate(
        str(out),
        pagesize=A4,
        rightMargin=2 * cm, leftMargin=2 * cm,
        topMargin=2 * cm, bottomMargin=2 * cm,
        title=company_name,
        author="Financial Review System",
    )

    styles = _pdf_styles()

    story: list = []
    # Cover
    story.append(Paragraph(ar(company_name), styles["cover_title"]))
    if period:
        story.append(Paragraph(ar(period), styles["cover_subtitle"]))
    story.append(Spacer(1, 1.5 * cm))
    story.append(Paragraph(ar("القوائم المالية الرئيسية"), styles["h1"]))
    for key, stmt in statements.items():
        story.append(Paragraph(ar(f"• {stmt.title}"), styles["li"]))
    story.append(PageBreak())

    # Each statement
    for key, stmt in statements.items():
        story.extend(_statement_flowables(stmt, styles))
        story.append(PageBreak())

    # Notes
    if notes:
        story.append(Paragraph(ar("الإيضاحات المرفقة"), styles["h1"]))
        for n in notes:
            story.append(Paragraph(ar(f"إيضاح ({n.number}) — {n.title}"), styles["h2"]))
            story.append(Paragraph(ar(n.body), styles["body"]))
            if n.accounts:
                story.append(_notes_table(n))
            story.append(Spacer(1, 0.4 * cm))

    doc.build(story)
    return str(out)


def _pdf_styles() -> dict:
    return {
        "cover_title": ParagraphStyle(
            "CoverTitle", fontName=_ARABIC_FONT_BOLD, fontSize=28,
            alignment=2, textColor=colors.HexColor("#0F172A"),
            spaceAfter=12, leading=34,
        ),
        "cover_subtitle": ParagraphStyle(
            "CoverSub", fontName=_ARABIC_FONT_NAME, fontSize=14,
            alignment=2, textColor=colors.HexColor("#475569"),
            spaceAfter=20, leading=20,
        ),
        "h1": ParagraphStyle(
            "H1", fontName=_ARABIC_FONT_BOLD, fontSize=18,
            alignment=2, textColor=colors.HexColor("#0F172A"),
            spaceAfter=10, leading=24,
        ),
        "h2": ParagraphStyle(
            "H2", fontName=_ARABIC_FONT_BOLD, fontSize=14,
            alignment=2, textColor=colors.HexColor("#0F172A"),
            spaceAfter=8, leading=20,
        ),
        "body": ParagraphStyle(
            "Body", fontName=_ARABIC_FONT_NAME, fontSize=11,
            alignment=2, textColor=colors.HexColor("#334155"),
            spaceAfter=6, leading=18,
        ),
        "li": ParagraphStyle(
            "Li", fontName=_ARABIC_FONT_NAME, fontSize=12,
            alignment=2, textColor=colors.HexColor("#334155"),
            spaceAfter=4, leading=18,
        ),
        "cell_label": ParagraphStyle(
            "CellLabel", fontName=_ARABIC_FONT_NAME, fontSize=10,
            alignment=2, leading=14,
        ),
        "cell_amount": ParagraphStyle(
            "CellAmount", fontName=_ARABIC_FONT_NAME, fontSize=10,
            alignment=1, leading=14,
        ),
        "cell_total": ParagraphStyle(
            "CellTotal", fontName=_ARABIC_FONT_BOLD, fontSize=11,
            alignment=2, leading=14,
        ),
    }


def _statement_flowables(stmt: Statement, styles: dict) -> list:
    out: list = []
    out.append(Paragraph(ar(stmt.title), styles["h1"]))
    out.append(Paragraph(ar(stmt.subtitle), styles["li"]))
    if stmt.as_of:
        out.append(Paragraph(ar(f"كما في {stmt.as_of}"), styles["body"]))
    if stmt.period:
        out.append(Paragraph(ar(f"عن الفترة: {stmt.period}"), styles["body"]))
    out.append(Spacer(1, 0.4 * cm))

    # Build the table
    data = []
    for line in stmt.lines:
        if abs(line.amount) > 1e-9 or line.is_subtotal or line.is_total or line.is_total:
            indent = "&nbsp;" * (line.indent * 4)
            label = ar(f"{indent}{line.label}")
            amount = ar(fmt_amount(line.amount)) if abs(line.amount) > 1e-9 else "—"
            ref = ar(line.ref) if line.ref else ""
            data.append([label, amount, ref])
        else:
            data.append([ar(line.label), "", ""])

    if not data:
        return out

    t = Table(data, colWidths=[10 * cm, 4.5 * cm, 1.5 * cm])
    t.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
        ("FONT", (0, 0), (-1, -1), _ARABIC_FONT_NAME, 10),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CBD5E1")),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FFFFFF")),
    ]))
    # Bold & shade subtotals/totals
    for i, line in enumerate(stmt.lines):
        if line.is_subtotal:
            t.setStyle(TableStyle([
                ("FONT", (0, i), (-1, i), _ARABIC_FONT_BOLD, 10),
                ("BACKGROUND", (0, i), (-1, i), colors.HexColor("#F1F5F9")),
            ]))
        if line.is_total:
            t.setStyle(TableStyle([
                ("FONT", (0, i), (-1, i), _ARABIC_FONT_BOLD, 11),
                ("BACKGROUND", (0, i), (-1, i), colors.HexColor("#E2E8F0")),
                ("LINEABOVE", (0, i), (-1, i), 0.8, colors.HexColor("#0F172A")),
            ]))
    out.append(t)
    return out


def _notes_table(n: Note) -> Table:
    data = [[ar("الحساب"), ar("الرمز"), ar("المبلغ")]]
    for a in n.accounts:
        data.append([
            ar(a["name"]),
            ar(a["code"]),
            ar(fmt_amount(a["amount"])),
        ])
    t = Table(data, colWidths=[10 * cm, 3 * cm, 3 * cm])
    t.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
        ("FONT", (0, 0), (-1, -1), _ARABIC_FONT_NAME, 10),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F172A")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONT", (0, 0), (-1, 0), _ARABIC_FONT_BOLD, 10),
        ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CBD5E1")),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


# ──────────────────────────────────────────────────────────────────────────────
# Comparison exporter — Excel/PDF for two periods
# ──────────────────────────────────────────────────────────────────────────────

def export_comparison_excel(
    comparisons: dict,   # {"balance_sheet": [...], "income_statement": [...], ...}
    kpis: list[dict],
    out_path: str,
    company_name: str = "الشركة",
    period_current: str = "",
    period_prior: str = "",
) -> str:
    wb = Workbook()
    wb.remove(wb.active)

    cover = wb.create_sheet("ملخص")
    cover["A1"] = f"{company_name} - مقارنة الفترات"
    cover["A1"].font = Font(name="Calibri", size=20, bold=True)
    cover["A1"].alignment = Alignment(horizontal="center", readingOrder=2)
    cover.merge_cells("A1:E1")
    cover["A2"] = f"{period_prior}  ←→  {period_current}"
    cover["A2"].font = Font(name="Calibri", size=12, italic=True)
    cover["A2"].alignment = Alignment(horizontal="center", readingOrder=2)
    cover.merge_cells("A2:E2")

    # KPI table
    cover["A4"] = "المؤشرات الرئيسية"
    cover["A4"].font = Font(name="Calibri", size=14, bold=True)
    cover["A4"].alignment = Alignment(horizontal="right", readingOrder=2)
    cover.merge_cells("A4:E4")
    headers = ["المؤشر", "الفترة الحالية", "الفترة السابقة", "التغير", "نسبة التغير %"]
    for i, h in enumerate(headers, start=1):
        c = cover.cell(row=5, column=i, value=h)
        c.font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="1E293B")
        c.alignment = Alignment(horizontal="center", readingOrder=2)
    row = 6
    for k in kpis:
        cover.cell(row=row, column=1, value=k["name"])
        cover.cell(row=row, column=2, value=k["current"])
        cover.cell(row=row, column=3, value=k["prior"])
        cover.cell(row=row, column=4, value=k["change"])
        cover.cell(row=row, column=5, value=k["pct_change"] if k["pct_change"] is not None else "—")
        for col in range(1, 6):
            cover.cell(row=row, column=col).alignment = Alignment(
                horizontal="center" if col != 1 else "right", readingOrder=2
            )
        cover.cell(row=row, column=2).number_format = "#,##0.00"
        cover.cell(row=row, column=3).number_format = "#,##0.00"
        cover.cell(row=row, column=4).number_format = "#,##0.00;(#,##0.00)"
        cover.cell(row=row, column=5).number_format = "0.00%;(0.00%)"
        row += 1
    for col, w in zip("ABCDE", [28, 18, 18, 18, 18]):
        cover.column_dimensions[col].width = w

    # Per-statement comparison sheets
    titles = {
        "balance_sheet": "المركز المالي - مقارنة",
        "income_statement": "الدخل - مقارنة",
        "cash_flow": "التدفقات النقدية - مقارنة",
        "equity": "حقوق الملكية - مقارنة",
    }
    for key, rows in comparisons.items():
        ws = wb.create_sheet(titles.get(key, key)[:31])
        ws["A1"] = titles.get(key, key)
        ws["A1"].font = Font(name="Calibri", size=16, bold=True)
        ws["A1"].alignment = Alignment(horizontal="center", readingOrder=2)
        ws.merge_cells("A1:E1")

        hdr = ["البيان", "الفترة الحالية", "الفترة السابقة", "التغير", "نسبة التغير %"]
        for i, h in enumerate(hdr, start=1):
            c = ws.cell(row=3, column=i, value=h)
            c.font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
            c.fill = PatternFill("solid", fgColor="1E293B")
            c.alignment = Alignment(horizontal="center", readingOrder=2)

        for i, line in enumerate(rows, start=4):
            ws.cell(row=i, column=1, value=line["label"])
            ws.cell(row=i, column=2, value=line["current"])
            ws.cell(row=i, column=3, value=line["prior"])
            ws.cell(row=i, column=4, value=line["change"])
            ws.cell(row=i, column=5, value=line["pct_change"] if line["pct_change"] is not None else "—")
            font = Font(name="Calibri", size=11, bold=line.get("bold", False))
            for col in range(1, 6):
                c = ws.cell(row=i, column=col)
                c.font = font
                c.alignment = Alignment(horizontal="center" if col != 1 else "right", readingOrder=2)
            ws.cell(row=i, column=2).number_format = "#,##0.00;(#,##0.00)"
            ws.cell(row=i, column=3).number_format = "#,##0.00;(#,##0.00)"
            ws.cell(row=i, column=4).number_format = "#,##0.00;(#,##0.00)"
            ws.cell(row=i, column=5).number_format = "0.00%;(0.00%)"
        for col, w in zip("ABCDE", [40, 18, 18, 18, 18]):
            ws.column_dimensions[col].width = w

    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    wb.save(out)
    return str(out)
