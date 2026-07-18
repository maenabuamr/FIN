"""
Period comparison: take two trial balances (or two sets of statements)
and produce a side-by-side analysis with absolute and percentage change.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Optional

from .account_classifier import Account
from .financial_statements import Statement, _calc_net_profit
from .arabic_utils import fmt_amount, clean


# ──────────────────────────────────────────────────────────────────────────────
# Per-line comparison
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class CompareLine:
    label: str
    sub_category: str
    section: str
    current: float
    prior: float
    change: float
    pct_change: float           # % as decimal (0.10 = 10%); None when prior=0
    is_subtotal: bool = False
    is_total: bool = False
    bold: bool = False
    detail: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


def _pct(curr: float, prior: float) -> Optional[float]:
    if abs(prior) < 1e-9:
        return None
    return (curr - prior) / abs(prior)


# ──────────────────────────────────────────────────────────────────────────────
# Compare two statement dicts line-by-line
# ──────────────────────────────────────────────────────────────────────────────

def compare_statements(
    current: Statement,
    prior: Statement,
) -> list[CompareLine]:
    """
    Pair up lines between two Statement objects and produce comparison rows.
    Matches lines by (label + section) — works for same-template statements
    produced by our generators.
    """
    cur_map = {(l.label, l.section): l for l in current.lines}
    prior_map = {(l.label, l.section): l for l in prior.lines}

    keys = list(cur_map.keys() | prior_map.keys())
    # Preserve order of current statement
    ordered_keys = [k for k, _ in [(k, cur_map[k]) for k in cur_map]] + [
        k for k in keys if k not in cur_map
    ]

    out: list[CompareLine] = []
    for k in ordered_keys:
        l_cur = cur_map.get(k)
        l_pr  = prior_map.get(k)
        label, section = k
        cur_amt = l_cur.amount if l_cur else 0.0
        pr_amt  = l_pr.amount  if l_pr  else 0.0
        change  = cur_amt - pr_amt
        pct = _pct(cur_amt, pr_amt)
        out.append(CompareLine(
            label=label,
            sub_category=(l_cur.sub_category if l_cur else l_pr.sub_category),
            section=section,
            current=round(cur_amt, 2),
            prior=round(pr_amt, 2),
            change=round(change, 2),
            pct_change=round(pct, 4) if pct is not None else None,
            is_subtotal=(l_cur.is_subtotal if l_cur else (l_pr.is_subtotal if l_pr else False)),
            is_total=(l_cur.is_total if l_cur else (l_pr.is_total if l_pr else False)),
            bold=(l_cur.bold if l_cur else (l_pr.bold if l_pr else False)),
        ))
    return out


# ──────────────────────────────────────────────────────────────────────────────
# Compare two sets of accounts (line-by-line) for a custom diff
# ──────────────────────────────────────────────────────────────────────────────

def compare_accounts(
    current: list[Account],
    prior: list[Account],
) -> list[dict]:
    """
    Build a per-account movement table: code, name, current, prior, change, %.
    Matches on account code; falls back to name when code is missing.
    """
    def key(a: Account) -> str:
        return a.code or a.name

    cur_map = {key(a): a for a in current}
    prior_map = {key(a): a for a in prior}

    rows: list[dict] = []
    seen = set(cur_map.keys()) | set(prior_map.keys())
    for k in seen:
        a_cur = cur_map.get(k)
        a_pr  = prior_map.get(k)
        cur_b = a_cur.balance if a_cur else 0.0
        pr_b  = a_pr.balance  if a_pr  else 0.0
        change = cur_b - pr_b
        pct = _pct(cur_b, pr_b)
        rows.append({
            "code": (a_cur.code if a_cur else a_pr.code) or "",
            "name": (a_cur.name if a_cur else a_pr.name) or "",
            "sub_category": (a_cur.sub_category if a_cur else a_pr.sub_category),
            "current": round(cur_b, 2),
            "prior": round(pr_b, 2),
            "change": round(change, 2),
            "pct_change": round(pct, 4) if pct is not None else None,
        })
    rows.sort(key=lambda r: r.get("code", "") or r.get("name", ""))
    return rows


# ──────────────────────────────────────────────────────────────────────────────
# KPIs between two periods (for dashboard summary)
# ──────────────────────────────────────────────────────────────────────────────

def kpis(
    current: Statement,
    prior: Statement,
) -> list[dict]:
    """Compute a small set of key indicators between two statements."""
    ct = current.totals or {}
    pt = prior.totals or {}
    out: list[dict] = []

    def add(name: str, key: str, better_when_higher: bool = True):
        if key in ct and key in pt:
            cur, pr = ct[key], pt[key]
            change = cur - pr
            pct = _pct(cur, pr)
            out.append({
                "name": name,
                "current": round(cur, 2),
                "prior": round(pr, 2),
                "change": round(change, 2),
                "pct_change": round(pct, 4) if pct is not None else None,
                "direction": "up" if change > 0 else ("down" if change < 0 else "flat"),
                "favorable": (
                    (change > 0) if better_when_higher else (change < 0)
                ),
            })
    # P&L KPIs
    add("الإيرادات", "total_revenue", True)
    add("مجمل الربح", "gross_profit", True)
    add("الربح التشغيلي", "operating_profit", True)
    add("صافي الربح", "net_profit", True)
    add("إجمالي الأصول", "total_assets", True)
    add("إجمالي الالتزامات", "total_liab", False)
    add("إجمالي حقوق الملكية", "total_equity", True)
    return out
