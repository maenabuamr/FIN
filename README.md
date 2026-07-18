# نظام المراجعة المالية
## Financial Review System v2.0

> **نظام مراجعة مالية متعدد الشركات: ارفع ميزان مراجعة → عدّل، شيّك، صدّر قوائم مالية كاملة. كل شركة في ملف مستقل.**

A complete Arabic-first, multi-company financial review system. Each company has its own isolated workspace, trial balances, and statements. Upload a trial balance, edit the accounts inline, validate it, generate the four primary financial statements + notes, compare two periods, and export to Excel or PDF — with full Arabic support.

## ✨ What's new in v2.0

- **🏢 Multi-company**: Each company has its own isolated file (data/companies/\<id\>/.json). No data leaks between companies.
- **📋 Trial Balance screen**: A dedicated screen to view, edit, add, delete accounts inline. Changes auto-save and re-classify.
- **✅ Validation engine**: 10+ checks (TB balance, BS balance, low-confidence classifications, missing codes, duplicate codes, etc.) with a 0-100 score.
- **🔄 Auto-reclassify on edit**: Change amounts → instantly re-classified and re-statemented.
- **🔒 Per-company scoping**: Every endpoint takes `company_id` and isolates data. Cross-company access returns 404.

## ✨ Core features

- **Upload**: `.xlsx`, `.xls`, `.xlsm`, `.pdf`, `.csv` — auto-detects header row, columns, Arabic-Indic / Persian digits.
- **Auto-classify**: Account-number prefix (most reliable) + Arabic name keywords (fallback). Every account gets a confidence score.
- **Four financial statements**: Balance Sheet, Income Statement, Cash Flow, Statement of Changes in Equity.
- **Notes / disclosures**: Auto-generated numbered notes (إيضاحات) with policy text and account breakdown.
- **Period comparison**: KPIs + per-statement deltas + per-account movements.
- **Export**: Excel (with full RTL formatting) and PDF (with Amiri Arabic font).

## 🚀 Quick Start

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 generate_sample.py
bash run.sh          # starts at http://localhost:8000
```

## 📂 Project layout

```
financial_system/
├── app.py                       # FastAPI server (multi-company, trial balance CRUD, validation)
├── core/
│   ├── arabic_utils.py
│   ├── account_classifier.py
│   ├── financial_statements.py
│   ├── notes_generator.py
│   ├── file_parsers.py
│   ├── comparator.py
│   ├── exporters.py
│   ├── store.py                 # Multi-company persistence
│   └── validator.py             # Validation engine
├── data/companies/              # Per-company JSON files
├── static/css/style.css
├── static/js/app.js             # Multi-company frontend
├── static/fonts/Amiri-*.ttf
├── templates/index.html
└── samples/sample_trial_balance.xlsx
```

## 🖱️ Usage flow

1. Open the app → if no company, the **الشركات** screen shows.
2. Create a company (name + tax ID + currency).
3. **ميزان المراجعة** screen → upload or click "تجربة بميزان عينة".
4. The **تفاصيل وتعديل** tab shows all accounts as inline-editable inputs.
5. The **تشييك** tab runs 10 validation checks → score 0-100.
6. **القوائم المالية** shows the 4 statements.
7. **الإيضاحات** shows the notes.
8. **المقارنات** compares two periods.

## 🌐 API (all scoped by `?company_id=`)

| Method | Endpoint                              | Description                              |
| ------ | ------------------------------------- | ---------------------------------------- |
| GET    | `/api/companies`                      | List all companies                       |
| POST   | `/api/companies`                      | Create a company                         |
| GET    | `/api/companies/{id}`                 | Get company details                      |
| PUT    | `/api/companies/{id}`                 | Update company                           |
| DELETE | `/api/companies/{id}`                 | Delete company + all its data            |
| GET    | `/api/jobs?company_id=X`              | List trial balances for a company        |
| POST   | `/api/upload?company_id=X`            | Upload a trial balance                   |
| POST   | `/api/process/{job_id}?company_id=X`  | Classify + build statements             |
| GET    | `/api/jobs/{job_id}?company_id=X`     | Get full job data                        |
| DELETE | `/api/jobs/{job_id}?company_id=X`     | Delete a job                             |
| PUT    | `/api/jobs/{job_id}/accounts/{idx}`   | Update a single account                  |
| POST   | `/api/jobs/{job_id}/accounts`         | Add a new account                        |
| DELETE | `/api/jobs/{job_id}/accounts/{idx}`   | Delete an account                        |
| POST   | `/api/jobs/{job_id}/reclassify`       | Change an account's sub-category         |
| GET    | `/api/jobs/{job_id}/validate`         | Run 10 validation checks                 |
| GET    | `/api/statements/{job_id}`            | Fetch the four statements                |
| GET    | `/api/notes/{job_id}`                 | Fetch the notes                          |
| GET    | `/api/export/{fmt}/{job_id}`          | Export Excel or PDF                      |
| POST   | `/api/compare`                        | Compare two jobs (cross-company OK)      |
| GET    | `/api/load_sample?company_id=X`       | Bootstrap a sample trial balance         |
| POST   | `/api/load_demo`                      | Create a demo company                    |

## 🌍 Arabic support

1. **UI**: `dir="rtl"`, Tajawal/Cairo font stack, `readingOrder=2` in Excel cells.
2. **PDF export**: `arabic-reshaper` + `python-bidi` + embedded Amiri font.
3. **Number parsing**: Converts Arabic-Indic (٠١٢٣) and Persian (۰۱۲۳) digits to Western.
4. **Name matching**: `safe_key()` removes diacritics, tatweel, the `ال` prefix — robust to variant spellings.

## 🧪 Testing

```bash
source venv/bin/activate
python3 run_e2e_test.py
```

You should see: `✓ ALL TESTS PASSED`

## 📜 License

Standalone demo / starter system. Amiri font is SIL OFL. Sample data is fictional.

