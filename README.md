# نظام المراجعة المالية
## Financial Review System

> **ارفع ميزان مراجعة (Excel / PDF / CSV) → استلم القوائم المالية الأربعة + الإيضاحات + قارن بين فترتين + صدّر لـ Excel أو PDF — كله عربي صح بدون مشاكل.**

A complete Arabic-first financial review system. Upload a trial balance, get the four primary financial statements (Balance Sheet, Income Statement, Cash Flow, Statement of Changes in Equity) with notes/disclosures, compare two periods side-by-side, and export everything to Excel or PDF — with full Arabic support.

---

## ✨ Features

- **Upload trial balance**: `.xlsx`, `.xls`, `.xlsm`, `.pdf`, `.csv` — with auto-detection of header row, columns, and Arabic-Indic / Persian digits.
- **Auto-classify accounts**: Uses both account-number prefix (most reliable) and Arabic name keywords (fallback). Every account gets a confidence score.
- **Override classifications**: A dropdown lets you reclassify any account without re-uploading.
- **Four financial statements**:
  1. **قائمة المركز المالي** (Statement of Financial Position / Balance Sheet)
  2. **قائمة الدخل** (Statement of Profit or Loss)
  3. **قائمة التدفقات النقدية** (Statement of Cash Flows — indirect method)
  4. **قائمة التغيرات في حقوق الملكية** (Statement of Changes in Equity)
- **Notes / disclosures**: Auto-generated numbered notes (إيضاحات) attached to every account category with accounting-policy text and a movement table.
- **Period comparison**: Pick any two jobs, get a side-by-side comparison with KPIs, per-statement deltas, percentage changes, and per-account movements.
- **Export**: Excel (with full RTL formatting, proper number formats, embedded fonts) and PDF (with Amiri Arabic font for proper shaping — no broken letters).
- **Arabic-first UI**: Full RTL dashboard in Arabic with a clean professional layout, responsive cards, drag-and-drop upload, and live previews.

---

## 🚀 Quick Start

```bash
# 1) Create a virtual environment
python3 -m venv venv
source venv/bin/activate

# 2) Install dependencies
pip install -r requirements.txt

# 3) Generate the sample trial balance (optional — there's also a built-in sample button in the UI)
python3 generate_sample.py     # creates samples/sample_trial_balance.xlsx
python3 generate_sample_pdf.py # creates samples/sample_trial_balance.pdf

# 4) Run the server
uvicorn app:app --host 0.0.0.0 --port 8000
```

Open **http://localhost:8000** and click **"⚡ تحميل ميزان مراجعة عينة"** to try it instantly.

---

## 🧠 How the Account Classifier Works

The classifier scores each account and picks the highest-confidence category.

### 1. By account number (highest confidence)
Standard Arabic chart-of-accounts prefix:

| Prefix  | Sub-category                    |
| ------- | ------------------------------- |
| 11xx    | Cash & equivalents              |
| 12xx    | Receivables                     |
| 13xx    | Inventory                       |
| 14xx    | Prepayments                     |
| 15xx    | Other current assets            |
| 16xx    | PPE (Property, Plant, Equipment)|
| 17xx    | Intangible assets               |
| 18xx    | Investments                     |
| 19xx    | Other non-current assets        |
| 21xx    | Payables                        |
| 22xx    | Short-term loans                |
| 23xx    | Accruals                        |
| 24xx    | Other current liabilities       |
| 25xx    | Long-term loans                 |
| 26xx    | Other non-current liabilities   |
| 31xx    | Share capital                   |
| 32xx    | Reserves                        |
| 33xx    | Retained earnings               |
| 41xx    | Sales revenue                   |
| 42xx    | Service revenue                 |
| 49xx    | Other income                    |
| 51xx    | Cost of sales                   |
| 52xx    | Selling expenses                |
| 53xx    | Admin expenses                  |
| 54xx    | Depreciation                    |
| 55xx    | Finance costs                   |
| 59xx    | Other expenses                  |

### 2. By Arabic name (fallback)
If there's no account number, or it doesn't match a known prefix, the system matches the account name against a dictionary of ~150 Arabic / English keywords. The longest match wins (e.g. "مبيعات" beats "ات"), so short fragments don't false-trigger inside longer words.

### 3. Manual override
Any account can be reclassified via a dropdown in the UI — useful for edge cases like "مصروف صندوق بريد" where the word "صندوق" (cash box) would otherwise match "cash_and_equivalents".

---

## 📂 Project Layout

```
financial_system/
├── app.py                       # FastAPI server (HTTP endpoints)
├── core/
│   ├── arabic_utils.py          # Reshape, BiDi, digit conversion, amount formatting
│   ├── account_classifier.py    # Number + name-based classification
│   ├── financial_statements.py  # The 4 primary statements
│   ├── notes_generator.py       # Notes / disclosures builder
│   ├── file_parsers.py          # Excel, CSV, PDF readers
│   ├── comparator.py            # Period comparison + KPIs
│   └── exporters.py             # Excel + PDF export (with Arabic font)
├── static/
│   ├── css/style.css            # Full RTL Arabic stylesheet
│   ├── js/app.js                # Frontend logic (vanilla JS)
│   └── fonts/
│       ├── Amiri-Regular.ttf    # Arabic font for PDF
│       └── Amiri-Bold.ttf
├── templates/
│   └── index.html               # Dashboard layout
├── samples/
│   ├── sample_trial_balance.xlsx
│   └── sample_trial_balance.pdf
├── generate_sample.py           # Regenerate the Excel sample
├── generate_sample_pdf.py       # Regenerate the PDF sample
├── run_e2e_test.py              # End-to-end smoke test
├── requirements.txt
└── README.md
```

---

## 🌐 HTTP API

| Method | Endpoint                              | Description                                        |
| ------ | ------------------------------------- | -------------------------------------------------- |
| `POST` | `/api/upload`                         | Upload trial balance (multipart)                   |
| `POST` | `/api/process/{job_id}`               | Classify + build statements + notes                |
| `GET`  | `/api/statements/{job_id}`            | Fetch the four statements                          |
| `GET`  | `/api/notes/{job_id}`                 | Fetch the notes / disclosures                      |
| `POST` | `/api/reclassify/{job_id}`            | Reclassify a single account and rebuild            |
| `GET`  | `/api/export/{fmt}/{job_id}`          | Export as Excel or PDF (`xlsx` / `pdf`)            |
| `POST` | `/api/compare`                        | Compare two jobs (current vs prior)                |
| `POST` | `/api/compare/export/{fmt}`           | Export the comparison as Excel or PDF              |
| `GET`  | `/api/load_sample`                    | Bootstrap a sample trial balance (dev convenience) |
| `GET`  | `/api/jobs`                           | List all jobs in the store                         |

### Example: full upload + process + export

```bash
# 1) Upload
JOB_ID=$(curl -s -X POST http://localhost:8000/api/upload \
  -F "file=@samples/sample_trial_balance.xlsx" \
  -F "period=2024" | jq -r .job_id)

# 2) Process
curl -s -X POST "http://localhost:8000/api/process/$JOB_ID" \
  -d "company_name=شركة المثال&period=2024&currency=ر.س"

# 3) Export PDF
curl -s "http://localhost:8000/api/export/pdf/$JOB_ID" -o financial_report.pdf
```

---

## 🧪 Testing

```bash
source venv/bin/activate
python3 run_e2e_test.py
```

This runs the full pipeline:
1. Load sample
2. Process (builds 4 statements + 24 notes)
3. Reclassify an account
4. Export Excel + PDF
5. Create a second job and compare
6. Export comparison Excel + PDF
7. Verify the job list
8. Confirm bad files are rejected

You should see: `✓ ALL TESTS PASSED`

---

## 🌍 Arabic Support

Three layers ensure Arabic text never breaks:

1. **UI**: `dir="rtl"` on the `<html>`, Arabic font stack (`Tajawal`, `Cairo`, `Noto Sans Arabic`), and `readingOrder=2` in Excel cells.
2. **PDF export**: `arabic-reshaper` joins the letters, then `python-bidi` reorders them for visual display, then embedded **Amiri** font renders the final glyphs.
3. **Number parsing**: `to_western_digits()` converts Arabic-Indic (٠١٢٣) and Persian (۰۱۲۳) digits to Western (0-9) before processing.
4. **Search/compare**: `safe_key()` normalizes text — removes diacritics, tatweel, the `ال` prefix, and lowercases — so classification is robust to variant spellings.

---

## 📜 License

This is a standalone demo / starter system. The Amiri font is licensed under the SIL Open Font License. The bundled sample data is fictional.

---

## 🙋 Support

Open an issue, send a message, or just say hi. Happy auditing!
