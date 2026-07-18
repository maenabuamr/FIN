"""
Notes / disclosures generator.

Builds a numbered set of notes (الإيضاحات) attached to the financial
statements. Each note explains a sub-category, lists its accounts, and
provides a movement table where relevant.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Optional

from .account_classifier import Account, SUB_CATEGORY
from .financial_statements import Statement
from .arabic_utils import fmt_amount, clean


# ──────────────────────────────────────────────────────────────────────────────
# Note registry
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class Note:
    number: int
    title: str
    body: str
    table: list[dict] = field(default_factory=list)  # rows of {label, amount}
    accounts: list[dict] = field(default_factory=list)  # per-account detail

    def to_dict(self) -> dict:
        return asdict(self)


NOTE_TITLES = {
    "cash_and_equivalents":         "النقدية وما في حكمها",
    "receivables":                  "المدينون والحسابات المستحقة",
    "inventory":                    "المخزون",
    "prepayments":                  "المصروفات المقدمة",
    "other_current_assets":         "الأصول المتداولة الأخرى",
    "ppe":                          "الممتلكات والآلات والمعدات",
    "intangible_assets":            "الأصول غير الملموسة",
    "investments":                  "الاستثمارات",
    "other_non_current_assets":     "أصول غير متداولة أخرى",
    "payables":                     "الدائنون والحسابات المستحقة",
    "short_term_loans":             "القروض قصيرة الأجل",
    "accruals":                     "المصروفات المستحقة والمخصصات",
    "other_current_liabilities":    "التزامات متداولة أخرى",
    "long_term_loans":              "القروض طويلة الأجل",
    "other_non_current_liabilities": "التزامات غير متداولة أخرى",
    "share_capital":                "رأس المال",
    "reserves":                     "الاحتياطيات",
    "retained_earnings":            "الأرباح المبقاة",
    "treasury":                     "أسهم الخزينة",
    "sales_revenue":                "إيرادات المبيعات",
    "service_revenue":              "إيرادات الخدمات",
    "other_income":                 "الإيرادات الأخرى",
    "cost_of_sales":                "تكلفة المبيعات",
    "selling_expenses":             "مصاريف البيع والتسويق",
    "admin_expenses":               "المصاريف الإدارية والعمومية",
    "finance_costs":                "تكاليف التمويل",
    "depreciation":                 "الإهلاك والاستهلاك",
    "other_expenses":               "مصاريف أخرى",
}


NOTE_BODY = {
    "cash_and_equivalents": (
        "يتمثل هذا البند في الأرصدة النقدية بالخزينة والحسابات الجارية لدى البنوك "
        "والودائع القصيرة الأجل عالية السيولة التي تستحق خلال ثلاثة أشهر أو أقل."
    ),
    "receivables": (
        "تتمثل الذمم المدينة في المبالغ المستحقة على العملاء عن مبيعات آجلة. "
        "يتم تسجيلها بالقيمة الاسمية بعد خصم أي مخصص ديون مشكوك في تحصيلها."
    ),
    "inventory": (
        "يتم تقييم المخزون بسعر التكلفة أو صافي القيمة القابلة للتحقق، أيهما أقل، "
        "وفقاً لطريقة المتوسط المرجح."
    ),
    "ppe": (
        "يتم قياس الممتلكات والآلات والمعدات بالتكلفة ناقصاً الاستهلاك المتراكم "
        "وأي خسائر انخفاض في القيمة. يتم احتساب الاستهلاك بطريقة القسط الثابت "
        "على مدى العمر الإنتاجي المقدر لكل أصل."
    ),
    "intangible_assets": (
        "يتم قياس الأصول غير الملموسة بالتكلفة ناقصاً الإطفاء المتراكم. "
        "يتم إطفاء الأصول ذات العمر المحدد على مدى عمرها الإنتاجي المقدر."
    ),
    "payables": (
        "تتمثل الذمم الدائنة في المبالغ المستحقة للموردين عن مشتريات آجلة. "
        "يتم الاعتراف بها عند استلام البضاعة أو الخدمات."
    ),
    "short_term_loans": (
        "تمثل التسهيلات والقروض البنكية التي تستحق السداد خلال 12 شهراً."
    ),
    "long_term_loans": (
        "تمثل القروض البنكية والصكوك التي تستحق السداد بعد أكثر من 12 شهراً."
    ),
    "accruals": (
        "تتمثل في المصروفات المستحقة والمخصصات المعترف بها وفق مبدأ الاستحقاق، "
        "بما في ذلك مخصص تعويضات نهاية الخدمة للموظفين."
    ),
    "share_capital": (
        "يمثل رأس المال المدفوع من قبل الشركاء أو المساهمين وفق عقد التأسيس."
    ),
    "reserves": (
        "تتمثل في الاحتياطيات النظامية والقانونية والأخرى وفقاً للنظام الأساسي "
        "ولوائح الشركات المعمول بها."
    ),
    "retained_earnings": (
        "تتمثل في الأرباح المتراكمة من سنوات سابقة بعد خصم التوزيعات وأي تعديلات."
    ),
    "sales_revenue": (
        "يتم الاعتراف بالإيرادات عند تحويل المخاطر والعوائد الجوهرية للملكية إلى "
        "المشتري، وعندما يكون من المرجح تدفق المنافع الاقتصادية المرتبطة بالمعاملة."
    ),
    "service_revenue": (
        "يتم الاعتراف بإيرادات الخدمات عند إتمام الخدمة المقدمة وفقاً لطبيعة العقد."
    ),
    "other_income": (
        "تتمثل في الإيرادات المتنوعة كالفوائد الدائنة وأرباح بيع الأصول والإيرادات العرضية."
    ),
    "cost_of_sales": (
        "تتمثل في التكلفة المباشرة للبضاعة المباعة والخدمات المقدمة."
    ),
    "admin_expenses": (
        "تتمثل في المصاريف الإدارية والعمومية اللازمة لإدارة أعمال الشركة."
    ),
    "selling_expenses": (
        "تتمثل في المصاريف المتعلقة بنشاط البيع والتسويق والإعلان."
    ),
    "finance_costs": (
        "تتمثل في الفوائد والعمولات البنكية والتكاليف المرتبطة بتمويل أنشطة الشركة."
    ),
    "depreciation": (
        "تتمثل في قسط الإهلاك والاستهلاك المخصص على الأصول القابلة للإهلاك خلال الفترة."
    ),
}


# ──────────────────────────────────────────────────────────────────────────────
# Builder
# ──────────────────────────────────────────────────────────────────────────────

def build_notes(
    accounts: list[Account],
    statements: dict[str, Statement],
    company_name: str = "الشركة",
    period: str = "",
) -> list[Note]:
    """
    Build a numbered list of notes for every populated sub-category.
    """
    notes: list[Note] = []

    # Group accounts by sub-category
    by_sub: dict[str, list[Account]] = {}
    for a in accounts:
        by_sub.setdefault(a.sub_category, []).append(a)

    # Build a per-sub-category note only if it has non-zero amounts
    number = 0
    for sub in [
        "cash_and_equivalents",
        "receivables", "inventory", "prepayments", "other_current_assets",
        "ppe", "intangible_assets", "investments", "other_non_current_assets",
        "payables", "short_term_loans", "accruals", "other_current_liabilities",
        "long_term_loans", "other_non_current_liabilities",
        "share_capital", "reserves", "retained_earnings", "treasury",
        "sales_revenue", "service_revenue", "other_income",
        "cost_of_sales", "selling_expenses", "admin_expenses",
        "depreciation", "finance_costs", "other_expenses",
    ]:
        items = by_sub.get(sub, [])
        if not items:
            continue

        total = sum(a.balance for a in items)
        if abs(total) < 1e-9 and not items:
            continue

        number += 1
        title = NOTE_TITLES.get(sub, sub)
        body = NOTE_BODY.get(
            sub,
            f"يتمثل هذا البند في الحسابات المُصنّفة ضمن {title}."
        )

        accounts_detail = [
            {"code": a.code, "name": a.name, "amount": a.balance, "type": a.type}
            for a in items if abs(a.balance) > 1e-9
        ]

        table = [{"label": "الرصيد في نهاية الفترة", "amount": total}]

        notes.append(Note(
            number=number,
            title=title,
            body=body,
            table=table,
            accounts=accounts_detail,
        ))

    return notes


def attach_note_refs(statements: dict[str, Statement], notes: list[Note]) -> None:
    """
    Update the financial-statement lines with note-number references so the
    user can click an item in the UI and jump to its note.
    """
    # Map sub_category → note number
    sub_to_note = {}
    for n in notes:
        # Re-derive sub from title (loose — but unique enough for our domain)
        for sub, t in NOTE_TITLES.items():
            if t == n.title:
                sub_to_note[sub] = n.number
                break

    for stmt in statements.values():
        for line in stmt.lines:
            if line.sub_category in sub_to_note:
                line.ref = str(sub_to_note[line.sub_category])
