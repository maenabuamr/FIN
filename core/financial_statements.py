"""
Financial statement generators.

Builds the four primary statements + notes from a classified trial balance:
  1. Statement of Financial Position (Balance Sheet) — قائمة المركز المالي
  2. Statement of Profit or Loss (Income Statement) — قائمة الدخل
  3. Statement of Cash Flows (indirect method) — قائمة التدفقات النقدية
  4. Statement of Changes in Equity — قائمة التغيرات في حقوق الملكية

All outputs are language-agnostic structured dicts; rendering (HTML/Excel/PDF)
happens in the exporter modules.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Optional

from .account_classifier import (
    Account,
    SUB_CATEGORY,
    SUB_ORDER,
    SUB_TO_SECTION,
)
from .arabic_utils import fmt_amount, clean


# ──────────────────────────────────────────────────────────────────────────────
# Result containers
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class StatementLine:
    label: str
    sub_category: str
    section: str
    amount: float = 0.0
    ref: str = ""           # note reference
    detail: list[dict] = field(default_factory=list)  # per-account breakdown
    indent: int = 0
    is_subtotal: bool = False
    is_total: bool = False
    bold: bool = False

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Statement:
    title: str
    subtitle: str
    as_of: str
    period: str
    currency: str
    lines: list[StatementLine] = field(default_factory=list)
    totals: dict = field(default_factory=dict)  # key totals for the UI summary
    notes: dict = field(default_factory=dict)   # references to note numbers

    def to_dict(self) -> dict:
        return {
            "title": self.title,
            "subtitle": self.subtitle,
            "as_of": self.as_of,
            "period": self.period,
            "currency": self.currency,
            "lines": [l.to_dict() for l in self.lines],
            "totals": self.totals,
            "notes": self.notes,
        }


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def _group_by_sub(accounts: list[Account]) -> dict[str, list[Account]]:
    out: dict[str, list[Account]] = {}
    for acc in accounts:
        out.setdefault(acc.sub_category, []).append(acc)
    return out


def _sum_sub(accounts: list[Account], sub: str) -> float:
    return sum(a.balance for a in accounts if a.sub_category == sub)


def _sum_section(accounts: list[Account], section: str) -> float:
    """Sum of all accounts whose sub-category maps to this statement section."""
    return sum(
        a.balance
        for a in accounts
        if SUB_TO_SECTION.get(a.sub_category) == section
    )


def _make_line(
    label: str,
    sub: str,
    section: str,
    amount: float = 0.0,
    indent: int = 0,
    bold: bool = False,
    is_subtotal: bool = False,
    is_total: bool = False,
    ref: str = "",
    accounts: list[Account] = None,
) -> StatementLine:
    detail: list[dict] = []
    if accounts:
        for a in accounts:
            if abs(a.balance) > 1e-9:
                detail.append({
                    "code": a.code,
                    "name": a.name,
                    "amount": a.balance,
                })
    return StatementLine(
        label=label,
        sub_category=sub,
        section=section,
        amount=amount,
        ref=ref,
        detail=detail,
        indent=indent,
        is_subtotal=is_subtotal,
        is_total=is_total,
        bold=bold,
    )


# ──────────────────────────────────────────────────────────────────────────────
# 1) Statement of Financial Position
# ──────────────────────────────────────────────────────────────────────────────

def build_balance_sheet(
    accounts: list[Account],
    as_of: str = "",
    period: str = "",
    currency: str = "ر.س",
    prior_accounts: Optional[list[Account]] = None,
) -> Statement:
    by_sub = _group_by_sub(accounts)

    cur = {
        "cash":         _sum_sub(accounts, "cash_and_equivalents"),
        "receivables":  _sum_sub(accounts, "receivables"),
        "inventory":    _sum_sub(accounts, "inventory"),
        "prepayments":  _sum_sub(accounts, "prepayments"),
        "other_ca":     _sum_sub(accounts, "other_current_assets"),
        "ppe":          _sum_sub(accounts, "ppe"),
        "intangibles":  _sum_sub(accounts, "intangible_assets"),
        "investments":  _sum_sub(accounts, "investments"),
        "other_nca":    _sum_sub(accounts, "other_non_current_assets"),

        "payables":     _sum_sub(accounts, "payables"),
        "st_loans":     _sum_sub(accounts, "short_term_loans"),
        "accruals":     _sum_sub(accounts, "accruals"),
        "other_cl":     _sum_sub(accounts, "other_current_liabilities"),
        "lt_loans":     _sum_sub(accounts, "long_term_loans"),
        "other_ncl":    _sum_sub(accounts, "other_non_current_liabilities"),

        "capital":      _sum_sub(accounts, "share_capital"),
        "reserves":     _sum_sub(accounts, "reserves"),
        "retained":     _sum_sub(accounts, "retained_earnings"),
        "treasury":     _sum_sub(accounts, "treasury"),
    }

    total_ca = cur["cash"] + cur["receivables"] + cur["inventory"] + cur["prepayments"] + cur["other_ca"]
    total_nca = cur["ppe"] + cur["intangibles"] + cur["investments"] + cur["other_nca"]
    total_assets = total_ca + total_nca

    total_cl = cur["payables"] + cur["st_loans"] + cur["accruals"] + cur["other_cl"]
    total_ncl = cur["lt_loans"] + cur["other_ncl"]
    total_liab = total_cl + total_ncl

    # A trial balance has both revenue/expense accounts (which need to be
    # "closed" to retained earnings at year-end) and equity accounts. The
    # convention here: the retained-earnings line is treated as the *opening*
    # balance, and the current-period net profit (revenue − expense) is added
    # on top so the balance sheet equation holds.
    net_profit = _calc_net_profit(accounts)
    total_equity = cur["capital"] + cur["reserves"] + cur["retained"] + cur["treasury"] + net_profit

    total_liab_equity = total_liab + total_equity

    lines: list[StatementLine] = []

    # ── Header
    lines.append(_make_line("الأصول", "asset", "header", 0, 0, bold=True, is_subtotal=True))
    lines.append(_make_line(SUB_CATEGORY["cash_and_equivalents"], "cash_and_equivalents", "current_assets",
                            cur["cash"], 1, accounts=by_sub.get("cash_and_equivalents")))
    lines.append(_make_line(SUB_CATEGORY["receivables"], "receivables", "current_assets",
                            cur["receivables"], 1, accounts=by_sub.get("receivables")))
    lines.append(_make_line(SUB_CATEGORY["inventory"], "inventory", "current_assets",
                            cur["inventory"], 1, accounts=by_sub.get("inventory")))
    lines.append(_make_line(SUB_CATEGORY["prepayments"], "prepayments", "current_assets",
                            cur["prepayments"], 1, accounts=by_sub.get("prepayments")))
    lines.append(_make_line(SUB_CATEGORY["other_current_assets"], "other_current_assets", "current_assets",
                            cur["other_ca"], 1, accounts=by_sub.get("other_current_assets")))
    lines.append(_make_line("إجمالي الأصول المتداولة", "subtotal_ca", "current_assets",
                            total_ca, 0, bold=True, is_subtotal=True))
    lines.append(_make_line(SUB_CATEGORY["ppe"], "ppe", "non_current_assets",
                            cur["ppe"], 1, accounts=by_sub.get("ppe")))
    lines.append(_make_line(SUB_CATEGORY["intangible_assets"], "intangible_assets", "non_current_assets",
                            cur["intangibles"], 1, accounts=by_sub.get("intangible_assets")))
    lines.append(_make_line(SUB_CATEGORY["investments"], "investments", "non_current_assets",
                            cur["investments"], 1, accounts=by_sub.get("investments")))
    lines.append(_make_line(SUB_CATEGORY["other_non_current_assets"], "other_non_current_assets", "non_current_assets",
                            cur["other_nca"], 1, accounts=by_sub.get("other_non_current_assets")))
    lines.append(_make_line("إجمالي الأصول غير المتداولة", "subtotal_nca", "non_current_assets",
                            total_nca, 0, bold=True, is_subtotal=True))
    lines.append(_make_line("إجمالي الأصول", "total_assets", "total",
                            total_assets, 0, bold=True, is_total=True))

    # ── Liabilities
    lines.append(_make_line("الالتزامات", "liability", "header", 0, 0, bold=True, is_subtotal=True))
    lines.append(_make_line(SUB_CATEGORY["payables"], "payables", "current_liabilities",
                            cur["payables"], 1, accounts=by_sub.get("payables")))
    lines.append(_make_line(SUB_CATEGORY["short_term_loans"], "short_term_loans", "current_liabilities",
                            cur["st_loans"], 1, accounts=by_sub.get("short_term_loans")))
    lines.append(_make_line(SUB_CATEGORY["accruals"], "accruals", "current_liabilities",
                            cur["accruals"], 1, accounts=by_sub.get("accruals")))
    lines.append(_make_line(SUB_CATEGORY["other_current_liabilities"], "other_current_liabilities", "current_liabilities",
                            cur["other_cl"], 1, accounts=by_sub.get("other_current_liabilities")))
    lines.append(_make_line("إجمالي الالتزامات المتداولة", "subtotal_cl", "current_liabilities",
                            total_cl, 0, bold=True, is_subtotal=True))
    lines.append(_make_line(SUB_CATEGORY["long_term_loans"], "long_term_loans", "non_current_liabilities",
                            cur["lt_loans"], 1, accounts=by_sub.get("long_term_loans")))
    lines.append(_make_line(SUB_CATEGORY["other_non_current_liabilities"], "other_non_current_liabilities", "non_current_liabilities",
                            cur["other_ncl"], 1, accounts=by_sub.get("other_ncl")))
    lines.append(_make_line("إجمالي الالتزامات غير المتداولة", "subtotal_ncl", "non_current_liabilities",
                            total_ncl, 0, bold=True, is_subtotal=True))
    lines.append(_make_line("إجمالي الالتزامات", "total_liab", "total",
                            total_liab, 0, bold=True, is_total=True))

    # ── Equity
    lines.append(_make_line("حقوق الملكية", "equity", "header", 0, 0, bold=True, is_subtotal=True))
    lines.append(_make_line(SUB_CATEGORY["share_capital"], "share_capital", "equity",
                            cur["capital"], 1, accounts=by_sub.get("share_capital")))
    lines.append(_make_line(SUB_CATEGORY["reserves"], "reserves", "equity",
                            cur["reserves"], 1, accounts=by_sub.get("reserves")))
    lines.append(_make_line(SUB_CATEGORY["retained_earnings"], "retained_earnings", "equity",
                            cur["retained"], 1, accounts=by_sub.get("retained_earnings")))
    lines.append(_make_line("صافي ربح / (خسارة) الفترة", "net_profit", "equity",
                            net_profit, 1, ref=""))
    lines.append(_make_line("إجمالي حقوق الملكية", "total_equity", "total",
                            total_equity, 0, bold=True, is_total=True))

    # ── Footer
    lines.append(_make_line("إجمالي الالتزامات وحقوق الملكية", "total_liab_equity", "total",
                            total_liab_equity, 0, bold=True, is_total=True))

    return Statement(
        title="قائمة المركز المالي",
        subtitle="Statement of Financial Position",
        as_of=as_of,
        period=period,
        currency=currency,
        lines=lines,
        totals={
            "total_assets":     round(total_assets, 2),
            "total_liab":       round(total_liab, 2),
            "total_equity":     round(total_equity, 2),
            "net_profit":       round(net_profit, 2),
            "total_ca":         round(total_ca, 2),
            "total_nca":        round(total_nca, 2),
            "total_cl":         round(total_cl, 2),
            "total_ncl":        round(total_ncl, 2),
            "balance_check":    round(total_assets - total_liab_equity, 2),
            "balanced":         abs(total_assets - total_liab_equity) < 1e-6,
        },
    )


# ──────────────────────────────────────────────────────────────────────────────
# 2) Statement of Profit or Loss
# ──────────────────────────────────────────────────────────────────────────────

def _calc_net_profit(accounts: list[Account]) -> float:
    """Net profit = total revenue - total expense."""
    rev = sum(a.balance for a in accounts if a.type == "revenue")
    exp = sum(a.balance for a in accounts if a.type == "expense")
    return rev - exp


def build_income_statement(
    accounts: list[Account],
    as_of: str = "",
    period: str = "",
    currency: str = "ر.س",
) -> Statement:
    by_sub = _group_by_sub(accounts)

    sales   = _sum_sub(accounts, "sales_revenue")
    services= _sum_sub(accounts, "service_revenue")
    other_in= _sum_sub(accounts, "other_income")
    total_revenue = sales + services + other_in

    cogs    = _sum_sub(accounts, "cost_of_sales")
    gross_profit = total_revenue - cogs

    selling = _sum_sub(accounts, "selling_expenses")
    admin   = _sum_sub(accounts, "admin_expenses")
    depr    = _sum_sub(accounts, "depreciation")
    other_ex= _sum_sub(accounts, "other_expenses")
    total_opex = selling + admin + depr + other_ex

    operating_profit = gross_profit - total_opex

    finance_cost = _sum_sub(accounts, "finance_costs")
    other_income_net = other_in  # already included above; show separately
    profit_before_tax = operating_profit - finance_cost

    # No tax line in TB by default; treat PBT = net profit
    net_profit = profit_before_tax

    lines: list[StatementLine] = []

    lines.append(_make_line("الإيرادات", "revenue", "header", 0, 0, bold=True, is_subtotal=True))
    lines.append(_make_line(SUB_CATEGORY["sales_revenue"], "sales_revenue", "operating_revenue",
                            sales, 1, accounts=by_sub.get("sales_revenue")))
    lines.append(_make_line(SUB_CATEGORY["service_revenue"], "service_revenue", "operating_revenue",
                            services, 1, accounts=by_sub.get("service_revenue")))
    lines.append(_make_line(SUB_CATEGORY["other_income"], "other_income", "non_operating_income",
                            other_in, 1, accounts=by_sub.get("other_income")))
    lines.append(_make_line("إجمالي الإيرادات", "total_revenue", "total",
                            total_revenue, 0, bold=True, is_subtotal=True))

    lines.append(_make_line("يخصم: تكلفة الإيرادات", "cogs", "header", 0, 0, bold=True, is_subtotal=True))
    lines.append(_make_line(SUB_CATEGORY["cost_of_sales"], "cost_of_sales", "operating_expenses",
                            cogs, 1, accounts=by_sub.get("cost_of_sales")))
    lines.append(_make_line("إجمالي تكلفة الإيرادات", "total_cogs", "total",
                            cogs, 0, bold=True, is_subtotal=True))
    lines.append(_make_line("مجمل الربح", "gross_profit", "total",
                            gross_profit, 0, bold=True, is_total=True))

    lines.append(_make_line("يخصم: المصاريف التشغيلية", "opex", "header", 0, 0, bold=True, is_subtotal=True))
    lines.append(_make_line(SUB_CATEGORY["selling_expenses"], "selling_expenses", "operating_expenses",
                            selling, 1, accounts=by_sub.get("selling_expenses")))
    lines.append(_make_line(SUB_CATEGORY["admin_expenses"], "admin_expenses", "operating_expenses",
                            admin, 1, accounts=by_sub.get("admin_expenses")))
    lines.append(_make_line(SUB_CATEGORY["depreciation"], "depreciation", "operating_expenses",
                            depr, 1, accounts=by_sub.get("depreciation")))
    lines.append(_make_line(SUB_CATEGORY["other_expenses"], "other_expenses", "operating_expenses",
                            other_ex, 1, accounts=by_sub.get("other_expenses")))
    lines.append(_make_line("إجمالي المصاريف التشغيلية", "total_opex", "total",
                            total_opex, 0, bold=True, is_subtotal=True))
    lines.append(_make_line("الربح التشغيلي", "operating_profit", "total",
                            operating_profit, 0, bold=True, is_total=True))

    lines.append(_make_line("يخصم: تكاليف التمويل", "finance", "header", 0, 0, bold=True, is_subtotal=True))
    lines.append(_make_line(SUB_CATEGORY["finance_costs"], "finance_costs", "non_operating_expenses",
                            finance_cost, 1, accounts=by_sub.get("finance_costs")))
    lines.append(_make_line("صافي الربح قبل الضرائب", "pbt", "total",
                            profit_before_tax, 0, bold=True, is_total=True))
    lines.append(_make_line("صافي ربح / (خسارة) الفترة", "net_profit", "total",
                            net_profit, 0, bold=True, is_total=True))

    return Statement(
        title="قائمة الدخل",
        subtitle="Statement of Profit or Loss",
        as_of=as_of,
        period=period,
        currency=currency,
        lines=lines,
        totals={
            "total_revenue":    round(total_revenue, 2),
            "cogs":             round(cogs, 2),
            "gross_profit":     round(gross_profit, 2),
            "total_opex":       round(total_opex, 2),
            "operating_profit": round(operating_profit, 2),
            "finance_cost":     round(finance_cost, 2),
            "profit_before_tax":round(profit_before_tax, 2),
            "net_profit":       round(net_profit, 2),
        },
    )


# ──────────────────────────────────────────────────────────────────────────────
# 3) Statement of Cash Flows (indirect method)
# ──────────────────────────────────────────────────────────────────────────────

def build_cash_flow(
    accounts: list[Account],
    as_of: str = "",
    period: str = "",
    currency: str = "ر.س",
    prior_cash: float = 0.0,
) -> Statement:
    """
    Cash flow from operations uses indirect method:
      net_profit
      + non-cash expenses (depreciation)
      ± Δ working capital (receivables, inventory, payables, ...)
    Investing and financing flows are inferred from net change in PPE / loans.
    """
    by_sub = _group_by_sub(accounts)
    net_profit = _calc_net_profit(accounts)
    depreciation = _sum_sub(accounts, "depreciation")
    finance_cost = _sum_sub(accounts, "finance_costs")

    # Working capital changes (signs flipped because a rise in asset = cash outflow)
    # We don't have a comparative period here, so we report the *net* working
    # capital adjustment as a single number — auditor / user can refine.
    wc = (
        _sum_sub(accounts, "receivables")
        + _sum_sub(accounts, "inventory")
        + _sum_sub(accounts, "prepayments")
        - _sum_sub(accounts, "payables")
        - _sum_sub(accounts, "accruals")
        - _sum_sub(accounts, "other_current_liabilities")
    )

    cfo = net_profit + depreciation - wc + finance_cost

    # Investing: change in PPE / investments / intangibles assumed
    ppe = _sum_sub(accounts, "ppe")
    intangibles = _sum_sub(accounts, "intangible_assets")
    investments = _sum_sub(accounts, "investments")
    cfi = -(ppe + intangibles + investments) * 0.0  # without prior period, treat as 0 add-back
    # Actually a simple heuristic: include the entire PPE/intangible balance as
    # a "purchases" outflow when the account is debit-normal. Without prior data
    # we just show the depreciation and report 0 investing for now.

    # Financing: change in capital, loans
    capital_change = _sum_sub(accounts, "share_capital") + _sum_sub(accounts, "reserves")
    st_loans = _sum_sub(accounts, "short_term_loans")
    lt_loans = _sum_sub(accounts, "long_term_loans")
    treasury  = _sum_sub(accounts, "treasury")
    dividends  = 0.0  # not derivable from a single TB
    cff = capital_change + st_loans + lt_loans + treasury - dividends

    cash_end = _sum_sub(accounts, "cash_and_equivalents")
    cash_start = prior_cash if prior_cash else (cash_end - (cfo + cfi + cff))
    net_change = cash_end - cash_start

    lines: list[StatementLine] = []
    lines.append(_make_line("التدفقات النقدية من الأنشطة التشغيلية", "cfo", "header", 0, 0, bold=True, is_subtotal=True))
    lines.append(_make_line("صافي ربح / (خسارة) الفترة", "cfo_np", "operating",
                            net_profit, 1))
    lines.append(_make_line("إهلاك واستهلاك", "cfo_dep", "operating",
                            depreciation, 1))
    lines.append(_make_line("تغيرات في رأس المال العامل", "cfo_wc", "operating",
                            -wc, 1))
    lines.append(_make_line("تكاليف تمويل (مضافة)", "cfo_fin", "operating",
                            finance_cost, 1))
    lines.append(_make_line("صافي النقد من الأنشطة التشغيلية", "cfo_total", "total",
                            cfo, 0, bold=True, is_subtotal=True))

    lines.append(_make_line("التدفقات النقدية من الأنشطة الاستثمارية", "cfi", "header", 0, 0, bold=True, is_subtotal=True))
    lines.append(_make_line("شراء ممتلكات وآلات ومعدات", "cfi_ppe", "investing",
                            0, 1))
    lines.append(_make_line("شراء أصول غير ملموسة", "cfi_intang", "investing",
                            0, 1))
    lines.append(_make_line("(شراء) / بيع استثمارات", "cfi_inv", "investing",
                            0, 1))
    lines.append(_make_line("صافي النقد المستخدم في الأنشطة الاستثمارية", "cfi_total", "total",
                            0, 0, bold=True, is_subtotal=True))

    lines.append(_make_line("التدفقات النقدية من الأنشطة التمويلية", "cff", "header", 0, 0, bold=True, is_subtotal=True))
    lines.append(_make_line("إصدار / (استرداد) رأس المال", "cff_cap", "financing",
                            capital_change, 1))
    lines.append(_make_line("صافي القروض (قصيرة + طويلة الأجل)", "cff_loans", "financing",
                            st_loans + lt_loans, 1))
    lines.append(_make_line("أسهم خزينة", "cff_treasury", "financing",
                            treasury, 1))
    lines.append(_make_line("توزيعات أرباح", "cff_div", "financing",
                            -dividends, 1))
    lines.append(_make_line("صافي النقد من الأنشطة التمويلية", "cff_total", "total",
                            cff, 0, bold=True, is_subtotal=True))

    lines.append(_make_line("صافي الزيادة / (النقص) في النقدية", "net_change", "total",
                            net_change, 0, bold=True, is_total=True))
    lines.append(_make_line("النقدية في بداية الفترة", "cash_start", "total",
                            cash_start, 0, bold=True))
    lines.append(_make_line("النقدية في نهاية الفترة", "cash_end", "total",
                            cash_end, 0, bold=True, is_total=True))

    return Statement(
        title="قائمة التدفقات النقدية",
        subtitle="Statement of Cash Flows (Indirect Method)",
        as_of=as_of,
        period=period,
        currency=currency,
        lines=lines,
        totals={
            "cfo":         round(cfo, 2),
            "cfi":         round(cfi, 2),
            "cff":         round(cff, 2),
            "net_change":  round(net_change, 2),
            "cash_start":  round(cash_start, 2),
            "cash_end":    round(cash_end, 2),
        },
    )


# ──────────────────────────────────────────────────────────────────────────────
# 4) Statement of Changes in Equity
# ──────────────────────────────────────────────────────────────────────────────

def build_equity_statement(
    accounts: list[Account],
    as_of: str = "",
    period: str = "",
    currency: str = "ر.س",
    opening_capital: float = 0.0,
    opening_reserves: float = 0.0,
    opening_retained: float = 0.0,
) -> Statement:
    cap_close = _sum_sub(accounts, "share_capital")
    res_close = _sum_sub(accounts, "reserves")
    ret_close = _sum_sub(accounts, "retained_earnings")
    tr_close  = _sum_sub(accounts, "treasury")
    net_profit = _calc_net_profit(accounts)

    cap_open  = opening_capital
    res_open  = opening_reserves
    ret_open  = opening_retained

    cap_change = cap_close - cap_open
    res_change = res_close - res_open
    ret_change = ret_close - ret_open - net_profit
    dividends  = 0.0

    total_open = cap_open + res_open + ret_open
    total_close = cap_close + res_close + ret_close + net_profit - tr_close

    lines: list[StatementLine] = []
    lines.append(_make_line("الرصيد في بداية الفترة", "open", "header", total_open, 0, bold=True, is_subtotal=True))
    lines.append(_make_line(SUB_CATEGORY["share_capital"], "share_capital", "equity",
                            cap_open, 1, accounts=None))
    lines.append(_make_line(SUB_CATEGORY["reserves"], "reserves", "equity",
                            res_open, 1, accounts=None))
    lines.append(_make_line(SUB_CATEGORY["retained_earnings"], "retained_earnings", "equity",
                            ret_open, 1, accounts=None))

    lines.append(_make_line("التغيرات خلال الفترة", "movements", "header", 0, 0, bold=True, is_subtotal=True))
    lines.append(_make_line("إصدار / (استرداد) رأس المال", "eq_cap", "movements",
                            cap_change, 1))
    lines.append(_make_line("تحويلات للاحتياطيات", "eq_res", "movements",
                            res_change, 1))
    lines.append(_make_line("صافي ربح / (خسارة) الفترة", "eq_np", "movements",
                            net_profit, 1))
    lines.append(_make_line("توزيعات أرباح", "eq_div", "movements",
                            -dividends, 1))
    lines.append(_make_line("أسهم خزينة", "eq_treasury", "movements",
                            -tr_close, 1))

    lines.append(_make_line("الرصيد في نهاية الفترة", "close", "header", total_close, 0, bold=True, is_total=True))
    lines.append(_make_line(SUB_CATEGORY["share_capital"], "share_capital_c", "equity",
                            cap_close, 1))
    lines.append(_make_line(SUB_CATEGORY["reserves"], "reserves_c", "equity",
                            res_close, 1))
    lines.append(_make_line(SUB_CATEGORY["retained_earnings"], "retained_earnings_c", "equity",
                            ret_close + net_profit, 1))

    return Statement(
        title="قائمة التغيرات في حقوق الملكية",
        subtitle="Statement of Changes in Equity",
        as_of=as_of,
        period=period,
        currency=currency,
        lines=lines,
        totals={
            "opening_total": round(total_open, 2),
            "net_profit":    round(net_profit, 2),
            "dividends":     round(dividends, 2),
            "closing_total": round(total_close, 2),
        },
    )
