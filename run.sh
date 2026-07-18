#!/bin/bash
# Quick start script for the Financial Review System

set -e
cd "$(dirname "$0")"

if [ ! -d "venv" ]; then
    echo "→ Creating virtual environment..."
    python3 -m venv venv
fi

source venv/bin/activate
echo "→ Installing dependencies..."
pip install -q -r requirements.txt

echo "→ Generating sample trial balance..."
python3 generate_sample.py 2>/dev/null || true
python3 generate_sample_pdf.py 2>/dev/null || true

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Financial Review System"
echo "  Server will start at http://localhost:8000"
echo "═══════════════════════════════════════════════════════════"
echo ""
uvicorn app:app --host 0.0.0.0 --port 8000 --log-level info
