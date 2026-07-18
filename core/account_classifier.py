"""
Account classifier.

Decides the financial-statement bucket for every account row in the
trial balance, using:
  1. Account number prefix  (most reliable)
  2. Account name keywords  (Arabic / English)

Output: 5 main types, each with sub-categories used in statement rendering.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, asdict
from typing import Optional

from .arabic_utils import safe_key, has_arabic, to_western_digits, clean


# ──────────────────────────────────────────────────────────────────────────────
# Category enums
# ──────────────────────────────────────────────────────────────────────────────

TYPE_ARABIC = {
    "asset":              "الأصول",
    "liability":          "الالتزامات",
    "equity":             "حقوق الملكية",
    "revenue":            "الإيرادات",
    "expense":            "المصروفات",
}

# Sub-categories used in the financial-statement templates
SUB_CATEGORY = {
    # Assets
    "cash_and_equivalents":         "النقدية وما في حكمها",
    "receivables":                  "المدينون",
    "inventory":                    "المخزون",
    "prepayments":                  "مصروفات مقدمة",
    "other_current_assets":         "أصول متداولة أخرى",
    "ppe":                          "الممتلكات والآلات والمعدات",
    "intangible_assets":            "الأصول غير الملموسة",
    "investments":                  "الاستثمارات طويلة الأجل",
    "other_non_current_assets":     "أصول غير متداولة أخرى",
    # Liabilities
    "payables":                     "الدائنون",
    "short_term_loans":             "قروض قصيرة الأجل",
    "accruals":                     "مصروفات مستحقة",
    "other_current_liabilities":    "التزامات متداولة أخرى",
    "long_term_loans":              "قروض طويلة الأجل",
    "other_non_current_liabilities": "التزامات غير متداولة أخرى",
    # Equity
    "share_capital":                "رأس المال",
    "reserves":                     "الاحتياطيات",
    "retained_earnings":            "أرباح مبقاة",
    "treasury":                     "أسهم خزينة",
    # Revenue
    "sales_revenue":                "إيرادات المبيعات",
    "service_revenue":              "إيرادات الخدمات",
    "other_income":                 "إيرادات أخرى",
    # Expenses
    "cost_of_sales":                "تكلفة المبيعات",
    "selling_expenses":             "مصاريف البيع والتسويق",
    "admin_expenses":               "المصاريف الإدارية والعمومية",
    "finance_costs":                "تكاليف التمويل",
    "depreciation":                 "الإهلاك والاستهلاك",
    "other_expenses":               "مصاريف أخرى",
    # Catch-all
    "unspecified":                  "غير مصنف",
}

# Which financial-statement section each sub-category belongs to (for layout)
SUB_TO_SECTION = {
    "cash_and_equivalents":         "current_assets",
    "receivables":                  "current_assets",
    "inventory":                    "current_assets",
    "prepayments":                  "current_assets",
    "other_current_assets":         "current_assets",
    "ppe":                          "non_current_assets",
    "intangible_assets":            "non_current_assets",
    "investments":                  "non_current_assets",
    "other_non_current_assets":     "non_current_assets",

    "payables":                     "current_liabilities",
    "short_term_loans":             "current_liabilities",
    "accruals":                     "current_liabilities",
    "other_current_liabilities":    "current_liabilities",
    "long_term_loans":              "non_current_liabilities",
    "other_non_current_liabilities": "non_current_liabilities",

    "share_capital":                "equity",
    "reserves":                     "equity",
    "retained_earnings":            "equity",
    "treasury":                     "equity",

    "sales_revenue":                "operating_revenue",
    "service_revenue":              "operating_revenue",
    "other_income":                 "non_operating_income",

    "cost_of_sales":                "operating_expenses",
    "selling_expenses":             "operating_expenses",
    "admin_expenses":               "operating_expenses",
    "depreciation":                 "operating_expenses",
    "finance_costs":                "non_operating_expenses",
    "other_expenses":               "non_operating_expenses",

    "unspecified":                  "review_required",
}

# Display order in financial statements
SUB_ORDER = [
    "cash_and_equivalents", "receivables", "inventory", "prepayments", "other_current_assets",
    "ppe", "intangible_assets", "investments", "other_non_current_assets",

    "payables", "short_term_loans", "accruals", "other_current_liabilities",
    "long_term_loans", "other_non_current_liabilities",

    "share_capital", "reserves", "retained_earnings", "treasury",

    "sales_revenue", "service_revenue", "other_income",
    "cost_of_sales", "selling_expenses", "admin_expenses", "depreciation",
    "finance_costs", "other_expenses",
    "unspecified",
]


# ──────────────────────────────────────────────────────────────────────────────
# Account number mapping — first-digit → main type
# ──────────────────────────────────────────────────────────────────────────────

DIGIT_TO_TYPE = {
    "1": "asset",
    "2": "liability",
    "3": "equity",
    "4": "revenue",
    "5": "expense",
    "6": "expense",   # cost of sales sometimes
    "7": "expense",   # other expenses
    "8": "expense",   # finance
    "9": "revenue",   # other income
}


# ──────────────────────────────────────────────────────────────────────────────
# Name keyword map
# ──────────────────────────────────────────────────────────────────────────────
# Each list is OR'd within itself. First matching list wins (priority order).
# Tuples are (sub_category, type).

NAME_RULES: list[tuple[list[str], tuple[str, str]]] = [
    # ─── Cash & equivalents
    (["نقدية", "نقد", "صندوق", "كاش"],          ("cash_and_equivalents", "asset")),
    (["بنك", "بنوك", "مصرف", "بنوك"],           ("cash_and_equivalents", "asset")),
    (["شيكات برسم التحصيل", "شيكات تحت التحصيل"], ("cash_and_equivalents", "asset")),
    (["ودائع قصيرة الأجل", "ودائع لاجل", "ودائع"], ("cash_and_equivalents", "asset")),

    # ─── Receivables
    (["مدينون", "ذمم مدينة", "حسابات مدينة", "مدين", "عملاء"], ("receivables", "asset")),
    (["أوراق قبض", "اوراق قبض", "سندات القبض", "كمبيالات مدينة"], ("receivables", "asset")),
    (["إيرادات مستحقة", "ايرادات مستحقة", "فوائد مستحقة"], ("receivables", "asset")),

    # ─── Inventory
    (["مخزون", "بضاعة", "بضائع", "مواد خام", "مخزون اخر المدة", "مخزون أول المدة"], ("inventory", "asset")),

    # ─── Prepayments & other current
    (["مصروف مسبق", "مصروف مقدم", "مقدمات", "دفعات مقدمة", "تأمينات"], ("prepayments", "asset")),
    (["إيرادات مقدمة", "ايرادات مقدمة"], ("other_current_liabilities", "liability")),  # unearned revenue
    (["أصول متداولة أخرى", "اصول متداولة اخرى", "أصول أخرى", "اصول اخرى"], ("other_current_assets", "asset")),

    # ─── PPE
    (["أثاث", "اثاث", "مفروشات", "أجهزة", "اجهزة", "حاسب", "كمبيوتر"], ("ppe", "asset")),
    (["سيارات", "مركبات", "وسائل نقل"],       ("ppe", "asset")),
    (["مباني", "مبنى", "أراضي", "اراضي", "عقارات"], ("ppe", "asset")),
    (["معدات", "الات", "آلات", "ماكينات", "معدات مكتبية"], ("ppe", "asset")),
    (["مجمع اهلاك", "مجمع إهلاك", "مجمع استهلاك"], ("ppe", "asset")),  # contra-asset

    # ─── Intangibles
    (["شهرة", "علامة تجارية", "براءة اختراع", "حقوق ملكية فكرية",
      "اصول غير ملموسة", "أصول غير ملموسة", "برامج"], ("intangible_assets", "asset")),

    # ─── Investments
    (["استثمارات", "استثمار", "حصة في شركات", "مساهمة في"], ("investments", "asset")),

    # ─── Other non-current
    (["أصول غير متداولة", "اصول غير متداولة"], ("other_non_current_assets", "asset")),

    # ─── Payables
    (["دائنون", "ذمم دائنة", "حسابات دائنة", "موردين", "موردون"], ("payables", "liability")),
    (["أوراق دفع", "اوراق دفع", "سندات الدفع", "كمبيالات دائنة"], ("payables", "liability")),

    # ─── Loans
    (["قرض", "قروض", "تسهيلات ائتمانية", "سلف بنكية", "سلفة بنكية"], ("short_term_loans", "liability")),
    (["قرض طويل", "قروض طويلة", "سندات", "صكوك", "سلف طويلة"], ("long_term_loans", "liability")),
    (["فوائد مستحقة", "فوائد على القروض"], ("accruals", "liability")),

    # ─── Accruals & provisions
    (["مصروف مستحق", "مستحقات", "مخصص", "مخصصات", "تعويضات نهاية الخدمة"], ("accruals", "liability")),

    # ─── Other liabilities
    (["التزامات متداولة أخرى", "التزامات اخرى", "دائنون اخرون"], ("other_current_liabilities", "liability")),
    (["التزامات غير متداولة"], ("other_non_current_liabilities", "liability")),

    # ─── Equity
    (["رأس المال", "راس المال", "رأس مال", "راس مال", "حصص الشركاء", "حصص الشركه"], ("share_capital", "equity")),
    (["احتياطي", "احتياطيات", "الاحتياطي النظامي", "احتياطي نظامي", "احتياطي عام",
      "احتياطي خاص", "علاوة إصدار", "علاوة اصدار"], ("reserves", "equity")),
    (["أرباح مبقاة", "ارباح مبقاة", "ارباح مرحلة", "أرباح مرحلة", "خسائر متراكمة",
      "ارباح غير موزعة", "أرباح غير موزعة", "الارباح المبقاة"], ("retained_earnings", "equity")),
    (["خزينة", "أسهم خزينة", "اسهم خزينة", "أسهم الخزينة"], ("treasury", "equity")),

    # ─── Revenue
    (["مبيعات", "إيراد المبيعات", "ايراد المبيعات", "بيع", "صافي المبيعات"], ("sales_revenue", "revenue")),
    (["إيراد خدمات", "ايراد خدمات", "خدمات", "أتعاب", "اتعاب"], ("service_revenue", "revenue")),
    (["إيرادات أخرى", "ايرادات اخرى", "ايرادات متنوعة", "إيرادات متنوعة",
      "ارباح رأسمالية", "أرباح رأسمالية", "ارباح بيع اصول", "أرباح بيع أصول",
      "ايراد استثمارات", "إيراد استثمارات", "فوائد دائنة", "عوائد استثمار",
      "فوائد مدينة", "فوائد دائمة", "ايرادات فوائد", "إيرادات فوائد",
      "ايراد فوائد", "إيراد فوائد", "فوائد"], ("other_income", "revenue")),

    # ─── Cost of sales
    (["تكلفة المبيعات", "تكلفة مبيعات", "تكلفه المبيعات", "تكلفة البضاعة",
      "تكلفة البضائع", "تكلفة الخدمات", "كلفة المبيعات"], ("cost_of_sales", "expense")),

    # ─── Selling
    (["مصاريف بيع", "مصروفات بيع", "مصاريف تسويق", "مصروفات تسويق",
      "دعاية", "اعلان", "إعلان", "تسويق", "عمولة مبيعات", "عمولات"], ("selling_expenses", "expense")),

    # ─── Admin
    (["مصاريف ادارية", "مصروفات ادارية", "مصاريف عمومية", "مصروفات عمومية",
      "رواتب", "أجور", "اجور", "إيجار", "ايجار", "كهرباء", "ماء", "هاتف",
      "مكافآت", "مكافاة", "تدريب", "قرطاسية", "مطبوعات", "بريد",
      "صيانة", "نظافة", "تأمين"], ("admin_expenses", "expense")),

    # ─── Depreciation
    (["إهلاك", "اهلاك", "استهلاك", "مخصصات اهلاك", "مصروف اهلاك"], ("depreciation", "expense")),

    # ─── Finance
    (["فوائد مدينة", "فوائد على القروض", "تكلفة التمويل", "تكاليف التمويل",
      "مصروفات بنكية", "مصاريف بنكية", "رسوم بنكية", "فوائد قروض",
      "خسائر فروقات عملة", "فروقات عملة مدينة"], ("finance_costs", "expense")),

    # ─── Other
    (["خسائر رأسمالية", "خسارة بيع اصول", "خسارة بيع أصول",
      "خسائر متنوعة", "مصروفات أخرى", "مصاريف اخرى", "مصروفات متنوعة",
      "مصاريف متنوعة", "تالف", "هالك", "إعانات", "اعانات"], ("other_expenses", "expense")),
]


# ──────────────────────────────────────────────────────────────────────────────
# Data classes
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class Account:
    code: str = ""
    name: str = ""
    debit: float = 0.0
    credit: float = 0.0
    balance: float = 0.0       # signed: +debit / -credit (for normal debit accounts)
    type: str = "unspecified"
    sub_category: str = "unspecified"
    is_normal_debit: bool = True
    note_ref: str = ""         # filled later by notes_generator
    confidence: float = 0.0
    rule_source: str = ""      # "number" | "name" | "default"

    def to_dict(self) -> dict:
        return asdict(self)


# ──────────────────────────────────────────────────────────────────────────────
# Classifier
# ──────────────────────────────────────────────────────────────────────────────

def _balance_for_type(opening_dr: float, opening_cr: float, is_normal_debit: bool) -> float:
    """Return the net balance signed for the statement (always + debit-balance)."""
    bal = opening_dr - opening_cr
    return bal if is_normal_debit else -bal


class AccountClassifier:
    """Classify a trial-balance row into a financial-statement bucket."""

    def __init__(self) -> None:
        # Pre-compute normalized rules
        self._rules: list[tuple[list[str], tuple[str, str]]] = [
            ([safe_key(k) for k in keywords], (sub, typ))
            for keywords, (sub, typ) in NAME_RULES
        ]

    # ------------------------------------------------------------------
    # Number-based classification
    # ------------------------------------------------------------------
    @staticmethod
    def classify_by_number(code: str) -> Optional[tuple[str, str]]:
        """
        Decide the sub-category by leading digits of the account code.
        Returns (sub_category, main_type) or None.
        """
        if not code:
            return None
        code_norm = re.sub(r"\D", "", to_western_digits(str(code)))
        if not code_norm:
            return None

        first = code_norm[0]
        main_type = DIGIT_TO_TYPE.get(first)
        if not main_type:
            return None

        # 2-digit prefix → sub-category mapping
        # Common Arabic chart of accounts:
        #   11xx = cash, 12xx = receivables, 13xx = inventory,
        #   14xx = prepayments, 15xx = other current assets
        #   16xx = PPE, 17xx = intangibles, 18xx = investments,
        #   19xx = other non-current
        #   21xx = payables, 22xx = short-term loans, 23xx = accruals,
        #   24xx = other current liab
        #   25xx = long-term loans, 26xx = other non-current liab
        #   31xx = share capital, 32xx = reserves, 33xx = retained earnings,
        #   34xx = treasury
        #   41xx = sales, 42xx = services, 49xx = other income
        #   51xx = COGS, 52xx = selling, 53xx = admin, 54xx = depreciation,
        #   55xx = finance, 59xx = other expenses
        if len(code_norm) >= 2:
            prefix2 = code_norm[:2]
            sub = {
                "11": "cash_and_equivalents",
                "12": "receivables",
                "13": "inventory",
                "14": "prepayments",
                "15": "other_current_assets",
                "16": "ppe",
                "17": "intangible_assets",
                "18": "investments",
                "19": "other_non_current_assets",

                "21": "payables",
                "22": "short_term_loans",
                "23": "accruals",
                "24": "other_current_liabilities",
                "25": "long_term_loans",
                "26": "other_non_current_liabilities",

                "31": "share_capital",
                "32": "reserves",
                "33": "retained_earnings",
                "34": "treasury",

                "41": "sales_revenue",
                "42": "service_revenue",
                "49": "other_income",

                "51": "cost_of_sales",
                "52": "selling_expenses",
                "53": "admin_expenses",
                "54": "depreciation",
                "55": "finance_costs",
                "59": "other_expenses",
            }.get(prefix2)

            if sub:
                return (sub, main_type)

        # Fallback by first digit only
        fallback = {
            "asset":     "other_current_assets",
            "liability": "other_current_liabilities",
            "equity":    "share_capital",
            "revenue":   "other_income",
            "expense":   "other_expenses",
        }
        return (fallback[main_type], main_type)

    # ------------------------------------------------------------------
    # Name-based classification
    # ------------------------------------------------------------------
    def classify_by_name(self, name: str) -> Optional[tuple[str, str, float]]:
        key = safe_key(name)
        if not key:
            return None
        # Collect ALL candidate matches (sub, typ, kw) and pick the longest
        # keyword — prevents very short keywords (e.g. "ات") from
        # wrong-matching inside longer words.
        candidates: list[tuple[int, str, str]] = []
        for keywords, (sub, typ) in self._rules:
            for kw in keywords:
                if kw and kw in key:
                    candidates.append((len(kw), sub, typ))
        if not candidates:
            return None
        # Pick the longest keyword
        candidates.sort(reverse=True)
        best_len, sub, typ = candidates[0]
        confidence = min(1.0, 0.5 + 0.1 * len(candidates))
        return (sub, typ, confidence)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def classify(
        self,
        code: str,
        name: str,
        debit: float = 0.0,
        credit: float = 0.0,
    ) -> Account:
        """
        Build an Account with the most confident classification.
        Priority: number (high) → name (medium) → balance-based default (low).
        """
        debit = float(debit or 0)
        credit = float(credit or 0)

        # Try by number first
        sub, typ = None, None
        confidence = 0.0
        rule_source = "default"

        num_res = self.classify_by_number(code)
        if num_res:
            sub, typ = num_res
            confidence = 0.95
            rule_source = "number"

        # Then by name
        name_res = self.classify_by_name(name)
        if name_res and (name_res[2] > confidence or not num_res):
            sub, typ, name_conf = name_res
            confidence = name_conf
            rule_source = "name"

        # Default by balance sign
        if not sub or not typ:
            if debit > credit:
                typ = "asset"
                sub = "other_current_assets"
            elif credit > debit:
                # Could be liability, equity, revenue, or contra-asset — guess by amount
                if abs(credit - debit) < 1e-9 and credit > 0:
                    typ, sub = "equity", "share_capital"
                else:
                    typ, sub = "liability", "other_current_liabilities"
            else:
                typ, sub = "asset", "other_current_assets"
            confidence = 0.3
            rule_source = "default"

        is_normal_debit = typ in ("asset", "expense")
        balance = _balance_for_type(debit, credit, is_normal_debit)

        return Account(
            code=clean(code),
            name=clean(name),
            debit=debit,
            credit=credit,
            balance=balance,
            type=typ,
            sub_category=sub,
            is_normal_debit=is_normal_debit,
            confidence=round(confidence, 2),
            rule_source=rule_source,
        )

    # ------------------------------------------------------------------
    # Override an account's category manually (for the UI override button)
    # ------------------------------------------------------------------
    @staticmethod
    def reclassify(account: Account, new_sub: str) -> Account:
        if new_sub not in SUB_CATEGORY:
            return account
        # Derive type from sub
        type_lookup = {
            "cash_and_equivalents": "asset", "receivables": "asset", "inventory": "asset",
            "prepayments": "asset", "other_current_assets": "asset",
            "ppe": "asset", "intangible_assets": "asset", "investments": "asset",
            "other_non_current_assets": "asset",

            "payables": "liability", "short_term_loans": "liability", "accruals": "liability",
            "other_current_liabilities": "liability",
            "long_term_loans": "liability", "other_non_current_liabilities": "liability",

            "share_capital": "equity", "reserves": "equity",
            "retained_earnings": "equity", "treasury": "equity",

            "sales_revenue": "revenue", "service_revenue": "revenue", "other_income": "revenue",
            "cost_of_sales": "expense", "selling_expenses": "expense",
            "admin_expenses": "expense", "depreciation": "expense",
            "finance_costs": "expense", "other_expenses": "expense",
            "unspecified": account.type,
        }
        account.sub_category = new_sub
        account.type = type_lookup.get(new_sub, account.type)
        account.is_normal_debit = account.type in ("asset", "expense")
        account.balance = _balance_for_type(account.debit, account.credit, account.is_normal_debit)
        account.confidence = 1.0
        account.rule_source = "manual"
        return account


# ──────────────────────────────────────────────────────────────────────────────
# Public list of options for the UI override dropdown
# ──────────────────────────────────────────────────────────────────────────────

def sub_category_options() -> list[dict]:
    """Grouped list of (label, sub_category) for <select>."""
    out = []
    for sub in SUB_ORDER:
        out.append({
            "value": sub,
            "label": SUB_CATEGORY[sub],
            "section": SUB_TO_SECTION[sub],
            "type": _section_to_type(SUB_TO_SECTION[sub]),
        })
    return out


def _section_to_type(section: str) -> str:
    if section.endswith("assets"):
        return "asset"
    if section.endswith("liabilities"):
        return "liability"
    if section == "equity":
        return "equity"
    if "revenue" in section or "income" in section:
        return "revenue"
    if "expenses" in section:
        return "expense"
    return "review_required"
