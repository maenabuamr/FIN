"""
Arabic text utilities for the financial review system.

Handles:
- Reshaping (joining Arabic letters)
- BiDi reordering (visual order for display)
- Number-to-Arabic-word conversion
- Digit normalization (Arabic-Indic ↔ Western)
- Direction helpers
"""

from __future__ import annotations

import re
import arabic_reshaper
from bidi.algorithm import get_display


# ──────────────────────────────────────────────────────────────────────────────
# Reshape + BiDi — for visual display in PDF, terminal, or any non-CSS context
# ──────────────────────────────────────────────────────────────────────────────

def ar(text: str) -> str:
    """
    Reshape and reorder Arabic text for proper visual rendering.
    Use for: reportlab, console output, image labels, etc.
    Does NOT touch English words, digits, or punctuation.
    """
    if text is None:
        return ""
    s = str(text)
    if not s:
        return ""
    try:
        reshaped = arabic_reshaper.reshape(s)
        return get_display(reshaped)
    except Exception:
        return s


def ar_line(*parts: str) -> str:
    """Join a logical sequence of strings so each piece is reshaped in order."""
    return " ".join(ar(p) for p in parts if p is not None)


# ──────────────────────────────────────────────────────────────────────────────
# Digits — convert between Arabic-Indic (٠١٢٣٤٥٦٧٨٩) and Western (0-9)
# ──────────────────────────────────────────────────────────────────────────────

ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩"
ARABIC_INDIC_EXT = "۰۱۲۳۴۵۶۷۸۹"  # Persian variant
WESTERN = "0123456789"

_AR2EN = str.maketrans(
    ARABIC_INDIC + ARABIC_INDIC_EXT,
    WESTERN + WESTERN,
)


def to_western_digits(text: str) -> str:
    """Convert any Arabic-Indic / Persian digits in the string to Western 0-9."""
    if text is None:
        return ""
    return str(text).translate(_AR2EN)


def is_arabic_char(ch: str) -> bool:
    if not ch:
        return False
    code = ord(ch)
    return (
        0x0600 <= code <= 0x06FF      # Arabic
        or 0x0750 <= code <= 0x077F    # Arabic Supplement
        or 0xFB50 <= code <= 0xFDFF    # Arabic Presentation Forms-A
        or 0xFE70 <= code <= 0xFEFF    # Arabic Presentation Forms-B
    )


def has_arabic(text: str) -> bool:
    if not text:
        return False
    return any(is_arabic_char(c) for c in str(text))


# ──────────────────────────────────────────────────────────────────────────────
# Numbers — format with thousands separators, parentheses for negatives
# ──────────────────────────────────────────────────────────────────────────────

def fmt_number(value, decimals: int = 2, parens_for_negative: bool = True) -> str:
    """
    Format a number like accounting style:
      1234.5  ->  1,234.50
     -1234.5  ->  (1,234.50)   if parens_for_negative
    """
    if value is None or value == "":
        return "—"
    try:
        v = float(value)
    except (TypeError, ValueError):
        return str(value)
    if v < 0 and parens_for_negative:
        return f"({abs(v):,.{decimals}f})"
    return f"{v:,.{decimals}f}"


def fmt_amount(value) -> str:
    """Accounting format: 2 decimals, commas, parens for negative."""
    return fmt_number(value, 2, True)


# ──────────────────────────────────────────────────────────────────────────────
# Period label — used across the UI
# ──────────────────────────────────────────────────────────────────────────────

HIJRI_MONTHS = [
    "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
    "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
]

MILADI_MONTHS = [
    "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
    "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
]


def month_name(month: int, hijri: bool = False) -> str:
    arr = HIJRI_MONTHS if hijri else MILADI_MONTHS
    return arr[(month - 1) % 12]


# ──────────────────────────────────────────────────────────────────────────────
# Cleaning — strip BOM, normalize whitespace, remove zero-width
# ──────────────────────────────────────────────────────────────────────────────

_BOM = "\ufeff"
_ZW = "\u200f\u200e\u200b\u200c\u200d\u2060\u2066\u2067\u2068\u2069"


def clean(text: str) -> str:
    if text is None:
        return ""
    s = str(text)
    s = s.replace(_BOM, "")
    s = re.sub(f"[{_ZW}]", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def safe_key(text: str) -> str:
    """
    Build a fuzzy comparison key: lowercased, no diacritics, no tatweel,
    no al-prefix variants, Western digits only.
    """
    if text is None:
        return ""
    s = clean(text).lower()
    s = s.replace("ـ", "")            # tatweel
    s = s.replace("ال", "", 1) if s.startswith("ال") else s
    s = re.sub(r"[\u064B-\u0652\u0670\u0640]", "", s)  # diacritics
    s = to_western_digits(s)
    s = re.sub(r"[^\w\s\u0600-\u06FF]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s
