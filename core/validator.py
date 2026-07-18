"""
Validation engine for trial balances.

Runs a battery of checks and returns a structured report with severity,
messages, and the offending rows (when applicable).
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Optional

from .account_classifier import Account
from .financial_statements import _calc_net_profit


# ──────────────────────────────────────────────────────────────────────────────
# Report data classes
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class CheckResult:
    code: str
    severity: str        # "ok" | "info" | "warning" | "error"
    title: str
    message: str
    accounts: list[dict] = None   # offending accounts, if any

    def to_dict(self) -> dict:
        d = asdict(self)
        if d["accounts"] is None:
            d["accounts"] = []
        return d


@dataclass
class ValidationReport:
    balanced: bool
    score: int                       # 0-100, 100 = perfect
    total_debit: float
    total_credit: float
    difference: float
    checks: list[CheckResult]
    summary: dict

    def to_dict(self) -> dict:
        return {
            "balanced": self.balanced,
            "score": self.score,
            "total_debit": round(self.total_debit, 2),
            "total_credit": round(self.total_credit, 2),
            "difference": round(self.difference, 2),
            "checks": [c.to_dict() for c in self.checks],
            "summary": self.summary,
        }


# ──────────────────────────────────────────────────────────────────────────────
# Main entry
# ──────────────────────────────────────────────────────────────────────────────

def validate_trial_balance(accounts: list[Account], statements: Optional[dict] = None) -> ValidationReport:
    checks: list[CheckResult] = []

    total_dr = sum(float(a.debit or 0) for a in accounts)
    total_cr = sum(float(a.credit or 0) for a in accounts)
    diff = total_dr - total_cr
    balanced = abs(diff) < 0.01

    # 1) TB balanced?
    checks.append(CheckResult(
        code="tb_balanced",
        severity="ok" if balanced else "error",
        title="توازن ميزان المراجعة",
        message=("مجموع المدين يساوي مجموع الدائن." if balanced
                 else f"يوجد فرق قدره {abs(diff):,.2f} — راجع الحسابات أو صحح الأرقام."),
    ))

    # 2) Every account has a code
    no_code = [a for a in accounts if not (a.code or "").strip()]
    checks.append(CheckResult(
        code="missing_codes",
        severity="warning" if no_code else "ok",
        title="أكواد الحسابات",
        message=(f"{len(no_code)} حساب بدون رمز." if no_code else "كل الحسابات لها رمز."),
        accounts=[{"code": "", "name": a.name, "amount": a.balance, "type": a.type} for a in no_code],
    ))

    # 3) Every account has a name
    no_name = [a for a in accounts if not (a.name or "").strip()]
    checks.append(CheckResult(
        code="missing_names",
        severity="error" if no_name else "ok",
        title="أسماء الحسابات",
        message=(f"{len(no_name)} حساب بدون اسم." if no_name else "كل الحسابات لها اسم."),
    ))

    # 4) Low-confidence classifications
    low_conf = [a for a in accounts if a.confidence < 0.6 and abs(a.balance) > 0]
    checks.append(CheckResult(
        code="low_confidence",
        severity="warning" if low_conf else "ok",
        title="تصنيفات تحتاج مراجعة",
        message=(
            f"{len(low_conf)} حساب ثقة التصنيف فيه أقل من 60% — راجعها يدوياً."
            if low_conf else "جميع التصنيفات بثقة عالية."
        ),
        accounts=[
            {"code": a.code, "name": a.name, "amount": a.balance,
             "sub_category": a.sub_category, "confidence": a.confidence,
             "rule_source": a.rule_source}
            for a in low_conf
        ],
    ))

    # 5) Unspecified sub-categories
    unspec = [a for a in accounts if a.sub_category == "unspecified" and abs(a.balance) > 0]
    checks.append(CheckResult(
        code="unspecified",
        severity="warning" if unspec else "ok",
        title="حسابات غير مصنفة",
        message=(
            f"{len(unspec)} حساب لم يُصنّف — حدد تصنيفها من القائمة المنسدلة."
            if unspec else "كل الحسابات مُصنّفة."
        ),
        accounts=[
            {"code": a.code, "name": a.name, "amount": a.balance, "type": a.type}
            for a in unspec
        ],
    ))

    # 6) Negative balances on normal-debit accounts (e.g. cash with credit balance)
    neg_normal = [a for a in accounts
                  if a.is_normal_debit and (a.debit - a.credit) < -0.01 and a.type != "expense"]
    # Expenses are debit-normal but we don't flag them
    if statements is not None:
        # Only flag asset/expense accounts with unusual credit balances
        neg_normal = [a for a in accounts
                      if a.type == "asset" and a.is_normal_debit and a.balance < -0.01]
    checks.append(CheckResult(
        code="negative_normal_balance",
        severity="info" if neg_normal else "ok",
        title="أرصدة غير معتادة",
        message=(
            f"{len(neg_normal)} حساب أصل برصيد دائن (غير معتاد)."
            if neg_normal else "لا توجد أرصدة غير معتادة."
        ),
        accounts=[
            {"code": a.code, "name": a.name, "amount": a.balance, "type": a.type}
            for a in neg_normal
        ],
    ))

    # 7) Duplicate codes
    seen: dict[str, list[Account]] = {}
    for a in accounts:
        if a.code:
            seen.setdefault(a.code, []).append(a)
    dupes = {k: v for k, v in seen.items() if len(v) > 1}
    dup_accounts = [a for v in dupes.values() for a in v]
    checks.append(CheckResult(
        code="duplicate_codes",
        severity="warning" if dupes else "ok",
        title="أكواد مكررة",
        message=(
            f"{len(dupes)} رمز مكرر ({sum(len(v) for v in dupes.values())} حساب)."
            if dupes else "لا توجد أكواد مكررة."
        ),
        accounts=[
            {"code": a.code, "name": a.name, "amount": a.balance} for a in dup_accounts
        ],
    ))

    # 8) Empty rows
    empty = [a for a in accounts
             if abs(float(a.debit or 0)) < 0.01 and abs(float(a.credit or 0)) < 0.01]
    checks.append(CheckResult(
        code="empty_rows",
        severity="info" if empty else "ok",
        title="صفوف فارغة",
        message=(
            f"{len(empty)} حساب بدون رصيد (مدين = 0 ودائن = 0)."
            if empty else "لا توجد صفوف فارغة."
        ),
        accounts=[
            {"code": a.code, "name": a.name} for a in empty[:20]  # cap
        ],
    ))

    # 9) BS balance (if statements provided)
    if statements and "balance_sheet" in statements:
        bs = statements["balance_sheet"]
        total_assets = bs.get("total_assets")
        total_liab   = bs.get("total_liab")
        total_equity = bs.get("total_equity")
        if total_assets is not None and total_liab is not None and total_equity is not None:
            bs_diff = total_assets - (total_liab + total_equity)
            checks.append(CheckResult(
                code="bs_balanced",
                severity="ok" if abs(bs_diff) < 0.01 else "error",
                title="توازن الميزانية",
                message=(
                    f"الأصول ({total_assets:,.2f}) = الالتزامات + حقوق الملكية ({total_liab + total_equity:,.2f}) ✓"
                    if abs(bs_diff) < 0.01
                    else f"فرق {abs(bs_diff):,.2f} بين الأصول ومصادر التمويل."
                ),
            ))

    # 10) Type distribution summary
    type_counts: dict[str, int] = {}
    for a in accounts:
        type_counts[a.type] = type_counts.get(a.type, 0) + 1
    type_summary = ", ".join(f"{k}: {v}" for k, v in sorted(type_counts.items()))

    # ── Score: start 100, deduct per issue
    score = 100
    for c in checks:
        if c.severity == "error":
            score -= 20
        elif c.severity == "warning":
            score -= 5
        elif c.severity == "info":
            score -= 1
    score = max(0, min(100, score))

    summary = {
        "total_accounts": len(accounts),
        "type_distribution": type_counts,
        "type_summary": type_summary,
        "low_confidence_count": len(low_conf),
        "unspecified_count": len(unspec),
        "duplicate_code_count": len(dupes),
        "empty_row_count": len(empty),
    }

    return ValidationReport(
        balanced=balanced,
        score=score,
        total_debit=total_dr,
        total_credit=total_cr,
        difference=diff,
        checks=checks,
        summary=summary,
    )
