"""
Generate a sample trial-balance PDF for testing.
Uses a Table with each cell as a Paragraph that mixes fonts to keep
the Arabic text in the right cell and digits intact.
"""
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pathlib import Path

pdfmetrics.registerFont(TTFont("ArabicAmiri", str(Path(__file__).parent / "static/fonts/Amiri-Regular.ttf")))
pdfmetrics.registerFont(TTFont("ArabicAmiri-Bold", str(Path(__file__).parent / "static/fonts/Amiri-Bold.ttf")))

# Same data as the Excel sample (balanced TB)
template = [
    ("1101", "الصندوق",                                80_000, 0),
    ("1102", "البنك الأهلي - حساب جاري",             220_000, 0),
    ("1201", "المدينون",                              150_000, 0),
    ("1202", "أوراق القبض",                            25_000, 0),
    ("1301", "المخزون",                                75_000, 0),
    ("1401", "مصروفات مقدمة",                          10_000, 0),
    ("1601", "الأثاث",                                 35_000, 0),
    ("1602", "أجهزة الحاسب الآلي",                     28_000, 0),
    ("1603", "السيارات",                               90_000, 0),
    ("1691", "مجمع إهلاك الأثاث",                           0,  4_000),
    ("1692", "مجمع إهلاك الأجهزة",                          0,  6_000),
    ("1693", "مجمع إهلاك السيارات",                         0, 18_000),
    ("1701", "برامج الحاسب",                           15_000, 0),
    ("1801", "استثمارات في شركات",                     60_000, 0),
    ("2101", "الدائنون",                                    0,  90_000),
    ("2102", "أوراق الدفع",                                 0,  35_000),
    ("2201", "قرض قصير الأجل",                             0,  60_000),
    ("2202", "سلفة بنكية",                                  0,  40_000),
    ("2301", "مخصص تعويضات نهاية الخدمة",                   0,  22_000),
    ("2401", "مصروفات مستحقة",                              0,  15_000),
    ("2501", "قرض طويل الأجل",                              0, 120_000),
    ("3101", "رأس المال",                                   0, 200_000),
    ("3201", "الاحتياطي النظامي",                           0,  25_000),
    ("3202", "احتياطي عام",                                 0,  12_000),
    ("3301", "أرباح مبقاة (رصيد أول المدة)",                0,  50_000),
    ("4101", "إيرادات المبيعات",                            0, 750_000),
    ("4201", "إيرادات الخدمات",                             0,  95_000),
    ("4901", "إيرادات فوائد",                               0,   4_000),
    ("5101", "تكلفة المبيعات",                         360_000, 0),
    ("5201", "مصاريف دعاية وإعلان",                    20_000, 0),
    ("5202", "عمولات مبيعات",                          14_000, 0),
    ("5301", "الرواتب والأجور",                       287_500, 0),
    ("5302", "إيجار المكتب",                           30_000, 0),
    ("5303", "كهرباء وماء",                             7_000, 0),
    ("5304", "هاتف وبريد",                              3_500, 0),
    ("5305", "صيانة",                                   5_000, 0),
    ("5401", "إهلاك الأثاث",                             1_000, 0),
    ("5402", "إهلاك الأجهزة",                            3_000, 0),
    ("5403", "إهلاك السيارات",                           9_000, 0),
    ("5501", "فوائد مدينة",                            12_000, 0),
    ("5502", "رسوم بنكية",                              2_000, 0),
    ("5901", "مصروفات متنوعة",                          4_000, 0),
]

out = Path(__file__).parent / "samples" / "sample_trial_balance.pdf"
doc = SimpleDocTemplate(
    str(out), pagesize=A4,
    rightMargin=1.5*cm, leftMargin=1.5*cm,
    topMargin=1.5*cm, bottomMargin=1.5*cm,
)

styles = {
    "title": ParagraphStyle("T", fontName="ArabicAmiri-Bold", fontSize=18, alignment=2, leading=24),
    "sub":   ParagraphStyle("S", fontName="ArabicAmiri", fontSize=12, alignment=2, leading=18, textColor=colors.HexColor("#475569")),
    "cell":  ParagraphStyle("C", fontName="ArabicAmiri", fontSize=10, alignment=2, leading=14),
    "cell_l": ParagraphStyle("CL", fontName="ArabicAmiri", fontSize=10, alignment=0, leading=14),
}

story = []
story.append(Paragraph("شركة المثال التجارية", styles["title"]))
story.append(Paragraph("ميزان المراجعة كما في 31 ديسمبر 2024", styles["sub"]))
story.append(Spacer(1, 0.5*cm))

# Build the data table: each cell is a Paragraph mixing fonts.
# Column order: Debit | Credit | Account Name | Code
# pdfplumber reads these left-to-right.
data = [[
    Paragraph('<font name="Helvetica-Bold">Debit</font>',   styles["cell"]),
    Paragraph('<font name="Helvetica-Bold">Credit</font>',  styles["cell"]),
    Paragraph('<font name="ArabicAmiri-Bold">اسم الحساب</font>',  styles["cell"]),
    Paragraph('<font name="Helvetica-Bold">Code</font>',    styles["cell"]),
]]
for code, name, dr, cr in template:
    data.append([
        Paragraph(f'<font name="Helvetica">{dr:,.2f}</font>' if dr else '<font name="Helvetica">0.00</font>', styles["cell"]),
        Paragraph(f'<font name="Helvetica">{cr:,.2f}</font>' if cr else '<font name="Helvetica">0.00</font>', styles["cell"]),
        Paragraph(f'<font name="ArabicAmiri">{name}</font>', styles["cell"]),
        Paragraph(f'<font name="Helvetica">{code}</font>',  styles["cell"]),
    ])

total_dr = sum(d for _, _, d, _ in template)
total_cr = sum(c for _, _, _, c in template)
data.append([
    Paragraph(f'<font name="Helvetica-Bold">{total_dr:,.2f}</font>', styles["cell"]),
    Paragraph(f'<font name="Helvetica-Bold">{total_cr:,.2f}</font>', styles["cell"]),
    Paragraph('<font name="ArabicAmiri-Bold">الإجمالي</font>', styles["cell"]),
    Paragraph('<font name="Helvetica-Bold"> </font>', styles["cell"]),
])

t = Table(data, colWidths=[3*cm, 3*cm, 9*cm, 2*cm])
t.setStyle(TableStyle([
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ("TOPPADDING", (0, 0), (-1, -1), 3),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CBD5E1")),
    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E293B")),
    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#0F172A")),
    ("TEXTCOLOR", (0, -1), (-1, -1), colors.white),
]))
story.append(t)

doc.build(story)
print(f"Saved: {out}")
