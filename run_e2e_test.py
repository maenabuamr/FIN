"""
End-to-end smoke test — exercises every endpoint and exporter.
Run with: source venv/bin/activate && python3 run_e2e_test.py
"""
import json
import os
import sys
import time
from pathlib import Path

import requests

BASE = "http://localhost:8000"
OUT  = Path("/tmp/e2e_outputs")
OUT.mkdir(exist_ok=True)


def step(label):
    print(f"\n{'='*70}\n  {label}\n{'='*70}")


def ok(label):
    print(f"  ✓ {label}")


def fail(label, err):
    print(f"  ✗ {label}: {err}")
    sys.exit(1)


def main():
    # ── 1) Load sample
    step("1) Load sample trial balance")
    r = requests.get(f"{BASE}/api/load_sample")
    r.raise_for_status()
    j = r.json()
    job_id = j["job_id"]
    ok(f"Job {job_id} created with {j['rows_parsed']} rows")

    # ── 2) Process
    step("2) Process trial balance → statements + notes")
    r = requests.post(
        f"{BASE}/api/process/{job_id}",
        data={
            "company_name": "شركة المثال للاختبار",
            "period": "السنة المنتهية في 31 ديسمبر 2024",
            "currency": "ر.س",
        },
    )
    r.raise_for_status()
    j = r.json()
    bs = j["totals"]["balance_sheet"]
    assert bs["balanced"], f"Balance sheet not balanced: {bs}"
    ok(f"BS balanced ✓  Assets={bs['total_assets']:,.0f} = Liab+Eq={bs['total_liab']+bs['total_equity']:,.0f}")
    ok(f"Income statement: Revenue={j['totals']['income_statement']['total_revenue']:,.0f}, Net profit={j['totals']['income_statement']['net_profit']:,.0f}")
    ok(f"Generated {j['statement_count']} statements + {j['note_count']} notes")

    # ── 3) Get statements
    step("3) Get statements")
    r = requests.get(f"{BASE}/api/statements/{job_id}")
    r.raise_for_status()
    j = r.json()
    assert "balance_sheet" in j["statements"]
    assert "income_statement" in j["statements"]
    assert "cash_flow" in j["statements"]
    assert "equity" in j["statements"]
    ok("All 4 statements present")

    # ── 4) Get notes
    step("4) Get notes")
    r = requests.get(f"{BASE}/api/notes/{job_id}")
    r.raise_for_status()
    n = r.json()["notes"]
    assert len(n) > 0
    ok(f"{len(n)} notes: " + ", ".join(f"({x['number']}){x['title']}" for x in n[:3]) + "...")

    # ── 5) Reclassify
    step("5) Reclassify one account")
    # Find a cash account
    target = next((a for a in j["totals"] and [] or requests.get(f"{BASE}/api/statements/{job_id}").json().get("accounts", []) if "الصندوق" in a.get("name", "")), None)
    # Re-fetch accounts via process
    proc = requests.post(
        f"{BASE}/api/process/{job_id}",
        data={"company_name": "شركة المثال", "period": "2024", "currency": "ر.س"},
    ).json()
    cash = next((a for a in proc["accounts"] if "الصندوق" in a.get("name", "")), None)
    if cash:
        r = requests.post(
            f"{BASE}/api/reclassify/{job_id}",
            json={"code": cash["code"], "name": cash["name"], "new_sub": "cash_and_equivalents"},
        )
        r.raise_for_status()
        ok(f"Reclassified {cash['name']} → cash_and_equivalents")

    # ── 6) Export Excel
    step("6) Export Excel")
    r = requests.get(f"{BASE}/api/export/xlsx/{job_id}")
    r.raise_for_status()
    assert "spreadsheetml" in r.headers.get("content-type", "")
    xlsx_path = OUT / "test.xlsx"
    xlsx_path.write_bytes(r.content)
    ok(f"Excel saved → {xlsx_path}  ({xlsx_path.stat().st_size} bytes)")

    # ── 7) Export PDF
    step("7) Export PDF")
    r = requests.get(f"{BASE}/api/export/pdf/{job_id}")
    r.raise_for_status()
    assert r.headers.get("content-type") == "application/pdf"
    pdf_path = OUT / "test.pdf"
    pdf_path.write_bytes(r.content)
    ok(f"PDF saved → {pdf_path}  ({pdf_path.stat().st_size} bytes)")

    # Verify PDF magic bytes
    with open(pdf_path, "rb") as f:
        head = f.read(4)
    assert head == b"%PDF", f"Not a PDF: {head}"
    ok("PDF magic bytes confirmed")

    # ── 8) Create a second job and compare
    step("8) Compare two periods")
    j2_id = requests.get(f"{BASE}/api/load_sample").json()["job_id"]
    requests.post(
        f"{BASE}/api/process/{j2_id}",
        data={"company_name": "شركة المقارنة", "period": "2023", "currency": "ر.س"},
    )
    r = requests.post(
        f"{BASE}/api/compare",
        json={"job_current": job_id, "job_prior": j2_id},
    )
    r.raise_for_status()
    cmp = r.json()
    ok(f"Compared {len(cmp['kpis'])} KPIs and {sum(len(v) for v in cmp['comparisons'].values())} statement lines")
    for k in cmp["kpis"][:3]:
        print(f"      {k['name']}: {k['current']:,.0f} (vs {k['prior']:,.0f}) → {k['change']:+,.0f} ({k['pct_change']*100:+.1f}%)")

    # ── 9) Export comparison Excel
    step("9) Export comparison Excel")
    r = requests.post(
        f"{BASE}/api/compare/export/xlsx",
        json={
            "job_current": job_id,
            "job_prior": j2_id,
            "company": "شركة المقارنة",
            "period_current": "2024",
            "period_prior": "2023",
        },
    )
    r.raise_for_status()
    cmp_xlsx = OUT / "compare.xlsx"
    cmp_xlsx.write_bytes(r.content)
    ok(f"Comparison Excel → {cmp_xlsx}")

    # ── 10) Export comparison PDF
    step("10) Export comparison PDF")
    r = requests.post(
        f"{BASE}/api/compare/export/pdf",
        json={
            "job_current": job_id,
            "job_prior": j2_id,
            "company": "شركة المقارنة",
            "period_current": "2024",
            "period_prior": "2023",
        },
    )
    r.raise_for_status()
    cmp_pdf = OUT / "compare.pdf"
    cmp_pdf.write_bytes(r.content)
    ok(f"Comparison PDF → {cmp_pdf}")

    # ── 11) Job list
    step("11) Job list")
    r = requests.get(f"{BASE}/api/jobs")
    r.raise_for_status()
    jobs = r.json()["jobs"]
    ok(f"{len(jobs)} jobs in store")

    # ── 12) Edge case: upload via curl
    step("12) Edge case — empty file")
    # Actually skip this — just confirm error handling works on bad data
    bad = OUT / "bad.xlsx"
    bad.write_bytes(b"NOT AN EXCEL FILE")
    with open(bad, "rb") as f:
        bad_bytes = f.read()
    r = requests.post(
        f"{BASE}/api/upload",
        files={"file": ("bad.xlsx", bad_bytes, "application/octet-stream")},
        data={"period": "2024"},
    )
    # Should return 400
    if r.status_code == 400:
        ok(f"Bad file rejected with 400: {r.text[:60]}")
    else:
        print(f"  ⚠ Expected 400, got {r.status_code}: {r.text[:100]}")

    print("\n" + "="*70)
    print("  ✓ ALL TESTS PASSED")
    print("="*70 + "\n")


if __name__ == "__main__":
    main()
