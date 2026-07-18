/* =============================================================
   Financial Review System — Frontend logic
   Vanilla JS, no framework. Talks to /api/*.
   ============================================================= */

const App = (() => {
    // ─── State ─────────────────────────────────────────────
    const state = {
        jobs: [],              // list of jobs (from /api/jobs)
        currentJob: null,      // job_id
        currentView: 'dashboard', // dashboard | statements | notes | compare
        currentStatement: 'balance_sheet',
        accounts: [],
        subCategories: [],
        company: 'الشركة',
        period: 'السنة المنتهية في 31 ديسمبر 2024',
        currency: 'ر.س',
        compare: { current: null, prior: null },
    };

    // ─── DOM helpers ───────────────────────────────────────
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => Array.from(document.querySelectorAll(sel));

    function el(tag, attrs = {}, ...children) {
        const e = document.createElement(tag);
        Object.entries(attrs || {}).forEach(([k, v]) => {
            if (k === 'class') e.className = v;
            else if (k === 'html') e.innerHTML = v;
            else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
            else if (v != null) e.setAttribute(k, v);
        });
        children.flat().forEach((c) => {
            if (c == null) return;
            e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        });
        return e;
    }

    function fmtAmount(v) {
        if (v == null || v === '') return '—';
        const n = Number(v);
        if (Number.isNaN(n)) return String(v);
        const abs = Math.abs(n);
        const s = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return n < 0 ? `(${s})` : s;
    }

    function fmtPct(v) {
        if (v == null) return '—';
        return (v * 100).toFixed(1) + '%';
    }

    // ─── Toast ─────────────────────────────────────────────
    function toast(msg, type = 'info', timeout = 3500) {
        const c = $('#toast-container');
        const t = el('div', { class: `toast ${type}` }, msg);
        c.appendChild(t);
        setTimeout(() => {
            t.style.opacity = '0';
            setTimeout(() => t.remove(), 300);
        }, timeout);
    }

    // ─── API ───────────────────────────────────────────────
    async function api(path, opts = {}) {
        const res = await fetch(path, opts);
        if (!res.ok) {
            const txt = await res.text();
            throw new Error(txt || res.statusText);
        }
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json')) return res.json();
        return res;
    }

    // ─── Render topbar ─────────────────────────────────────
    function renderTopbar() {
        $('.topbar-title')?.remove();
        const tb = $('.topbar');
        if (!tb) return;
        const title = state.currentView === 'dashboard' ? 'نظرة عامة' :
                      state.currentView === 'statements' ? 'القوائم المالية' :
                      state.currentView === 'notes' ? 'الإيضاحات' :
                      state.currentView === 'compare' ? 'مقارنة الفترات' : 'لوحة التحكم';
        const sub = state.currentView === 'dashboard' ? 'مرحباً بك في النظام المالي، إليك ملخص بياناتك.' :
                    state.currentView === 'statements' ? 'القوائم المالية الرئيسية المولّدة من ميزان المراجعة.' :
                    state.currentView === 'notes' ? 'الإيضاحات المرفقة مع القوائم المالية.' :
                    state.currentView === 'compare' ? 'قارن بين فترتين ماليتين واكشف الفروقات.' : '';
        tb.innerHTML = '';
        tb.appendChild(el('div', {},
            el('h1', { class: 'topbar-title' }, title),
            el('p', {}, sub)
        ));
        const actions = el('div', { style: 'display:flex; gap:8px;' });
        if (state.currentView === 'statements' && state.currentJob) {
            actions.appendChild(el('button', { class: 'btn btn-outline', onClick: () => exportFile('xlsx') }, '📊 تصدير Excel'));
            actions.appendChild(el('button', { class: 'btn btn-primary', onClick: () => exportFile('pdf') }, '📄 تصدير PDF'));
        }
        if (state.currentView === 'compare' && state.compare.current && state.compare.prior) {
            actions.appendChild(el('button', { class: 'btn btn-outline', onClick: () => exportCompare('xlsx') }, '📊 تصدير المقارنة'));
            actions.appendChild(el('button', { class: 'btn btn-primary', onClick: () => exportCompare('pdf') }, '📄 تصدير PDF المقارنة'));
        }
        tb.appendChild(actions);
    }

    // ─── Sidebar nav ──────────────────────────────────────
    function setupNav() {
        const items = [
            { key: 'dashboard', label: 'لوحة التحكم', icon: '◫' },
            { key: 'statements', label: 'القوائم المالية', icon: '▤' },
            { key: 'notes', label: 'الإيضاحات', icon: '⊟' },
            { key: 'compare', label: 'المقارنات', icon: '⇄' },
        ];
        const sec = $('#nav-section');
        sec.innerHTML = '';
        items.forEach((it) => {
            const a = el('a', { class: 'nav-item', href: '#', onClick: (e) => { e.preventDefault(); switchView(it.key); } },
                el('span', {}, it.icon),
                el('span', {}, it.label)
            );
            sec.appendChild(a);
        });
    }

    function setActiveNav(key) {
        $$('.nav-item').forEach((n) => n.classList.remove('active'));
        const items = $$('.nav-item');
        const idx = ['dashboard', 'statements', 'notes', 'compare'].indexOf(key);
        if (idx >= 0 && items[idx]) items[idx].classList.add('active');
    }

    // ─── View switcher ────────────────────────────────────
    function switchView(view) {
        state.currentView = view;
        setActiveNav(view);
        renderTopbar();
        if (view === 'dashboard') renderDashboard();
        else if (view === 'statements') renderStatements();
        else if (view === 'notes') renderNotes();
        else if (view === 'compare') renderCompare();
    }

    // ─── Dashboard ────────────────────────────────────────
    async function renderDashboard() {
        const main = $('#main-content');
        main.innerHTML = '';

        // Load sample if no jobs
        let jobs = [];
        try {
            const r = await api('/api/jobs');
            jobs = r.jobs || [];
        } catch (e) { /* ignore */ }
        state.jobs = jobs;

        // ── Top action: upload card
        const uploadCard = el('div', { class: 'section' },
            el('div', { class: 'section-header' },
                el('div', {},
                    el('div', { class: 'section-title' }, 'رفع ميزان مراجعة جديد'),
                    el('div', { class: 'section-subtitle' }, 'ارفع ملف ميزان المراجعة (Excel أو PDF) لتوليد القوائم المالية تلقائياً')
                )
            ),
            renderUploadForm()
        );
        main.appendChild(uploadCard);

        // ── Stats cards
        const totalJobs = jobs.length;
        const readyJobs = jobs.filter(j => j.status === 'ready').length;
        const inProgress = jobs.filter(j => j.status === 'uploaded').length;
        const totalAccounts = jobs.reduce((s, j) => s + (j.accounts || 0), 0);

        const stats = el('div', { class: 'cards' },
            el('div', { class: 'card' },
                el('div', { class: 'card-icon' }, '✓'),
                el('div', { class: 'card-body' },
                    el('div', { class: 'card-label' }, 'إجمالي القوائم المنجزة'),
                    el('div', { class: 'card-value' }, String(readyJobs))
                )
            ),
            el('div', { class: 'card warn' },
                el('div', { class: 'card-icon' }, '⌚'),
                el('div', { class: 'card-body' },
                    el('div', { class: 'card-label' }, 'قيد المعالجة'),
                    el('div', { class: 'card-value' }, String(inProgress))
                )
            ),
            el('div', { class: 'card info' },
                el('div', { class: 'card-icon' }, '⊞'),
                el('div', { class: 'card-body' },
                    el('div', { class: 'card-label' }, 'موازين المراجعة'),
                    el('div', { class: 'card-value' }, String(totalJobs))
                )
            ),
            el('div', { class: 'card neutral' },
                el('div', { class: 'card-icon' }, '∑'),
                el('div', { class: 'card-body' },
                    el('div', { class: 'card-label' }, 'إجمالي الحسابات'),
                    el('div', { class: 'card-value' }, String(totalAccounts))
                )
            )
        );
        main.appendChild(stats);

        // ── Two columns: recent statements + recent trial balances
        const two = el('div', { class: 'two-col' });

        // Recent statements
        const stmtCard = el('div', { class: 'section' },
            el('div', { class: 'section-header' },
                el('div', {},
                    el('div', { class: 'section-title' }, 'أحدث القوائم المالية'),
                    el('div', { class: 'section-subtitle' }, 'القوائم الجاهزة للمراجعة')
                )
            )
        );
        if (readyJobs === 0) {
            stmtCard.appendChild(el('div', { class: 'empty' },
                el('div', { class: 'empty-icon' }, '∅'),
                el('div', { class: 'empty-title' }, 'لا توجد قوائم مالية بعد')
            ));
        } else {
            const list = el('div', {});
            jobs.filter(j => j.status === 'ready').slice(0, 5).forEach(j => {
                list.appendChild(el('div', { class: 'job-item' },
                    el('div', { class: 'job-info' },
                        el('div', { class: 'job-name' }, j.filename || 'وظيفة'),
                        el('div', { class: 'job-meta' }, `${j.period} · ${j.accounts} حساب`)
                    ),
                    el('div', { class: 'job-actions' },
                        el('button', { class: 'btn btn-ghost', onClick: () => openJob(j.job_id) }, 'عرض'),
                        el('button', { class: 'btn btn-outline', onClick: () => exportFile('xlsx', j.job_id) }, 'Excel'),
                        el('button', { class: 'btn btn-primary', onClick: () => exportFile('pdf', j.job_id) }, 'PDF')
                    )
                ));
            });
            stmtCard.appendChild(list);
        }
        two.appendChild(stmtCard);

        // Recent trial balances
        const tbCard = el('div', { class: 'section' },
            el('div', { class: 'section-header' },
                el('div', {},
                    el('div', { class: 'section-title' }, 'أحدث موازين المراجعة'),
                    el('div', { class: 'section-subtitle' }, 'الميزانيات المرفوعة')
                )
            )
        );
        if (totalJobs === 0) {
            tbCard.appendChild(el('div', { class: 'empty' },
                el('div', { class: 'empty-icon' }, '∅'),
                el('div', { class: 'empty-title' }, 'لا توجد موازين مراجعة بعد')
            ));
        } else {
            const list = el('div', {});
            jobs.slice(0, 5).forEach(j => {
                const tag = j.status === 'ready'
                    ? el('span', { class: 'tag green' }, 'منجز')
                    : el('span', { class: 'tag gray' }, 'قيد المعالجة');
                list.appendChild(el('div', { class: 'job-item' },
                    el('div', { class: 'job-info' },
                        el('div', { class: 'job-name' }, j.filename || 'وظيفة'),
                        el('div', { class: 'job-meta' }, `${j.period} · ${j.accounts} حساب`)
                    ),
                    el('div', { class: 'job-actions' },
                        tag,
                        el('button', { class: 'btn btn-primary', onClick: () => processOrView(j.job_id) }, 'تجهيز')
                    )
                ));
            });
            tbCard.appendChild(list);
        }
        two.appendChild(tbCard);
        main.appendChild(two);
    }

    // ─── Upload form ──────────────────────────────────────
    function renderUploadForm() {
        const wrap = el('div', {});
        const uploadBox = el('label', { class: 'upload-box', for: 'file-input' },
            el('div', { class: 'upload-icon' }, '⬆'),
            el('div', { class: 'upload-text' }, 'اضغط هنا أو اسحب ملف ميزان المراجعة'),
            el('div', { class: 'upload-hint' }, 'Excel (.xlsx) أو PDF أو CSV')
        );
        const fileInput = el('input', { type: 'file', id: 'file-input', accept: '.xlsx,.xls,.xlsm,.pdf,.csv' });

        uploadBox.addEventListener('dragover', (e) => { e.preventDefault(); uploadBox.classList.add('drag-over'); });
        uploadBox.addEventListener('dragleave', () => uploadBox.classList.remove('drag-over'));
        uploadBox.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadBox.classList.remove('drag-over');
            if (e.dataTransfer.files[0]) handleUpload(e.dataTransfer.files[0]);
        });
        fileInput.addEventListener('change', (e) => {
            if (e.target.files[0]) handleUpload(e.target.files[0]);
        });
        uploadBox.appendChild(fileInput);

        const row = el('div', { class: 'form-row' },
            el('div', { class: 'form-field' },
                el('label', {}, 'اسم الشركة / المنشأة'),
                (() => {
                    const i = el('input', { type: 'text', value: state.company, placeholder: 'شركة المثال' });
                    i.addEventListener('input', (e) => state.company = e.target.value);
                    return i;
                })()
            ),
            el('div', { class: 'form-field' },
                el('label', {}, 'الفترة المالية'),
                (() => {
                    const i = el('input', { type: 'text', value: state.period, placeholder: '2024' });
                    i.addEventListener('input', (e) => state.period = e.target.value);
                    return i;
                })()
            ),
            el('div', { class: 'form-field' },
                el('label', {}, 'العملة'),
                (() => {
                    const i = el('input', { type: 'text', value: state.currency, placeholder: 'ر.س' });
                    i.addEventListener('input', (e) => state.currency = e.target.value);
                    return i;
                })()
            )
        );
        wrap.appendChild(uploadBox);
        wrap.appendChild(row);

        // Sample button
        const sampleBtn = el('button', { class: 'btn btn-outline', onClick: async () => {
            try {
                toast('جاري تحميل ملف العينة...', 'info');
                const r = await api('/api/load_sample');
                toast(`تم تحميل العينة (${r.rows_parsed} حساب)`, 'success');
                state.currentJob = r.job_id;
                state.period = 'السنة المنتهية في 31 ديسمبر 2024';
                state.company = 'شركة المثال';
                await renderAccounts(r.job_id);
                await processJob(r.job_id);
            } catch (e) {
                toast('فشل: ' + e.message, 'error');
            }
        }}, '⚡ تحميل ميزان مراجعة عينة');
        wrap.appendChild(el('div', { style: 'margin-top:12px;' }, sampleBtn));

        return wrap;
    }

    // ─── Upload + Process ─────────────────────────────────
    async function handleUpload(file) {
        try {
            const fd = new FormData();
            fd.append('file', file);
            fd.append('period', state.period);
            toast('جاري رفع الملف...', 'info');
            const r = await api('/api/upload', { method: 'POST', body: fd });
            toast(`تم استخراج ${r.rows_parsed} صف من الملف`, 'success');
            state.currentJob = r.job_id;
            state.subCategories = r.sub_categories || [];
            // Show preview
            await renderAccounts(r.job_id, r.rows);
        } catch (e) {
            toast('فشل الرفع: ' + e.message, 'error', 5000);
        }
    }

    async function renderAccounts(jobId, rows = null) {
        const main = $('#main-content');
        // Remove any existing preview
        $$('.preview-section').forEach((s) => s.remove());

        let accounts = state.accounts;
        if (!rows) {
            try {
                const r = await api(`/api/statements/${jobId}`);
                // already processed
            } catch (e) { /* not yet processed */ }
        }
        // Use the raw rows from upload response if available
        if (rows) {
            // Just store the data; preview is shown via processJob
        }
    }

    async function processJob(jobId) {
        try {
            toast('جاري تصنيف الحسابات وتوليد القوائم...', 'info');
            const fd = new FormData();
            fd.append('company_name', state.company);
            fd.append('period', state.period);
            fd.append('currency', state.currency);
            const r = await api(`/api/process/${jobId}`, { method: 'POST', body: fd });
            state.accounts = r.accounts;
            toast(`تم توليد ${r.statement_count} قوائم مالية و ${r.note_count} إيضاح`, 'success');
            state.currentJob = jobId;
            switchView('statements');
        } catch (e) {
            toast('فشل التجهيز: ' + e.message, 'error', 5000);
        }
    }

    async function openJob(jobId) {
        state.currentJob = jobId;
        try {
            const r = await api(`/api/statements/${jobId}`);
            state.accounts = r.accounts;
            switchView('statements');
        } catch (e) {
            toast('الوظيفة غير جاهزة', 'error');
        }
    }

    async function processOrView(jobId) {
        // If not ready, process; if ready, open
        const j = state.jobs.find(x => x.job_id === jobId);
        if (j && j.status === 'ready') {
            openJob(jobId);
        } else {
            state.currentJob = jobId;
            await processJob(jobId);
        }
    }

    // ─── Statements view ──────────────────────────────────
    async function renderStatements() {
        const main = $('#main-content');
        main.innerHTML = '';

        if (!state.currentJob) {
            main.appendChild(el('div', { class: 'empty' },
                el('div', { class: 'empty-icon' }, '∅'),
                el('div', { class: 'empty-title' }, 'لا توجد وظيفة محددة'),
                el('div', { class: 'empty-text' }, 'من فضلك ارفع ميزان مراجعة أولاً من لوحة التحكم')
            ));
            return;
        }

        let data;
        try {
            data = await api(`/api/statements/${state.currentJob}`);
        } catch (e) {
            main.appendChild(el('div', { class: 'empty' },
                el('div', { class: 'empty-text' }, 'الوظيفة لم تُجهّز بعد')
            ));
            return;
        }

        // Tabs for the 4 statements
        const tabs = el('div', { class: 'tabs' });
        const stmtLabels = {
            'balance_sheet': 'قائمة المركز المالي',
            'income_statement': 'قائمة الدخل',
            'cash_flow': 'التدفقات النقدية',
            'equity': 'حقوق الملكية',
        };
        Object.entries(stmtLabels).forEach(([k, v]) => {
            const t = el('div', {
                class: 'tab' + (state.currentStatement === k ? ' active' : ''),
                onClick: () => { state.currentStatement = k; renderStatements(); }
            }, v);
            tabs.appendChild(t);
        });
        main.appendChild(tabs);

        // KPIs row
        const totals = data.totals;
        const kpiRow = el('div', { class: 'cards' });
        const kpisToShow = state.currentStatement === 'income_statement'
            ? [
                ['إجمالي الإيرادات', totals.income_statement.total_revenue],
                ['مجمل الربح', totals.income_statement.gross_profit],
                ['صافي الربح', totals.income_statement.net_profit],
                ['الربح التشغيلي', totals.income_statement.operating_profit],
              ]
            : state.currentStatement === 'balance_sheet'
            ? [
                ['إجمالي الأصول', totals.balance_sheet.total_assets],
                ['إجمالي الالتزامات', totals.balance_sheet.total_liab],
                ['حقوق الملكية', totals.balance_sheet.total_equity],
                ['الحالة', totals.balance_sheet.balanced ? '✓ متوازن' : '⚠ غير متوازن'],
              ]
            : state.currentStatement === 'cash_flow'
            ? [
                ['التشغيل', totals.cash_flow.cfo],
                ['الاستثمار', totals.cash_flow.cfi],
                ['التمويل', totals.cash_flow.cff],
                ['صافي التغير', totals.cash_flow.net_change],
              ]
            : [
                ['رصيد أول المدة', totals.equity.opening_total],
                ['صافي الربح', totals.equity.net_profit],
                ['توزيعات', totals.equity.dividends],
                ['رصيد آخر المدة', totals.equity.closing_total],
              ];
        kpisToShow.forEach(([label, val]) => {
            const isStatus = typeof val === 'string';
            kpiRow.appendChild(el('div', { class: 'card neutral' },
                el('div', { class: 'card-icon' }, '∑'),
                el('div', { class: 'card-body' },
                    el('div', { class: 'card-label' }, label),
                    el('div', { class: 'card-value' }, isStatus ? val : fmtAmount(val))
                )
            ));
        });
        main.appendChild(kpiRow);

        // Statement table
        const stmt = data.statements[state.currentStatement];
        const section = el('div', { class: 'section' });
        section.appendChild(el('div', { class: 'section-header' },
            el('div', {},
                el('div', { class: 'section-title' }, stmt.title),
                el('div', { class: 'section-subtitle' }, stmt.subtitle)
            )
        ));
        section.appendChild(renderStatementTable(stmt, data.currency));
        main.appendChild(section);

        // Account classifications table — for reclassify
        if (state.accounts && state.accounts.length) {
            const acc = el('div', { class: 'section' },
                el('div', { class: 'section-header' },
                    el('div', {},
                        el('div', { class: 'section-title' }, 'تصنيف الحسابات'),
                        el('div', { class: 'section-subtitle' }, 'يمكنك تعديل تصنيف أي حساب من هنا إذا لزم الأمر')
                    )
                ),
                renderAccountsTable(state.accounts, state.subCategories)
            );
            main.appendChild(acc);
        }
    }

    function renderStatementTable(stmt, currency) {
        const wrap = el('div', { class: 'table-wrap' });
        const t = el('table', { class: 'statement' });
        const thead = el('thead', {},
            el('tr', {},
                el('th', { style: 'width:55%;' }, 'البيان'),
                el('th', { style: 'width:30%; text-align:left;' }, currency),
                el('th', { style: 'width:15%;' }, 'إيضاح')
            )
        );
        t.appendChild(thead);
        const tbody = el('tbody');
        stmt.lines.forEach((line) => {
            const classes = [];
            if (line.is_subtotal) classes.push('subtotal');
            if (line.is_total) classes.push('total');
            if (line.indent > 0) classes.push(`indent-${Math.min(line.indent, 2)}`);
            if (line.section && (line.section === 'header' || line.label === 'الأصول' || line.label === 'الالتزامات' || line.label === 'حقوق الملكية' || line.label.includes('الإيرادات') || line.label.includes('المصاريف') || line.label.includes('التدفقات'))) {
                classes.push('section-header');
            }

            const refCell = line.ref
                ? el('span', { class: 'ref-tag', onClick: () => showNoteDetail(line.ref, line.label) }, `(${line.ref})`)
                : '—';

            const tr = el('tr', { class: classes.join(' ') },
                el('td', {}, line.label),
                el('td', { class: 'amount' }, Math.abs(line.amount) > 1e-9 ? fmtAmount(line.amount) : '—'),
                el('td', {}, refCell)
            );
            tr.addEventListener('click', (e) => {
                if (e.target.classList.contains('ref-tag')) return;
                if (line.detail && line.detail.length) {
                    showLineDetail(line);
                }
            });
            tr.style.cursor = line.detail && line.detail.length ? 'pointer' : 'default';
            tbody.appendChild(tr);
        });
        t.appendChild(tbody);
        wrap.appendChild(t);
        return wrap;
    }

    function showLineDetail(line) {
        const body = el('div', { class: 'modal-body' });
        body.appendChild(el('p', { style: 'color:var(--text-light); margin-bottom:16px;' }, line.label));
        line.detail.forEach((d) => {
            body.appendChild(el('div', { class: 'detail-row' },
                el('div', { class: 'detail-name' }, `${d.code ? d.code + ' — ' : ''}${d.name}`),
                el('div', { class: 'detail-amount' }, fmtAmount(d.amount))
            ));
        });
        openModal(`تفاصيل: ${line.label}`, body);
    }

    function showNoteDetail(noteNumber, label) {
        api(`/api/notes/${state.currentJob}`).then(r => {
            const note = (r.notes || []).find(n => String(n.number) === String(noteNumber));
            if (!note) return;
            const body = el('div', { class: 'modal-body' });
            body.appendChild(el('h3', { style: 'margin-bottom:8px;' }, `إيضاح (${note.number}) — ${note.title}`));
            body.appendChild(el('p', { style: 'color:var(--text-light); margin-bottom:16px;' }, note.body));
            note.accounts.forEach((a) => {
                body.appendChild(el('div', { class: 'detail-row' },
                    el('div', { class: 'detail-name' }, `${a.code ? a.code + ' — ' : ''}${a.name}`),
                    el('div', { class: 'detail-amount' }, fmtAmount(a.amount))
                ));
            });
            openModal(`إيضاح ${note.number}`, body);
        });
    }

    function renderAccountsTable(accounts, subCategories) {
        const wrap = el('div', { class: 'table-wrap' });
        const t = el('table', { class: 'statement' });
        t.appendChild(el('thead', {},
            el('tr', {},
                el('th', { style: 'width:8%;' }, 'الرمز'),
                el('th', { style: 'width:30%;' }, 'اسم الحساب'),
                el('th', { style: 'width:14%;' }, 'مدين'),
                el('th', { style: 'width:14%;' }, 'دائن'),
                el('th', { style: 'width:14%;' }, 'الرصيد'),
                el('th', { style: 'width:18%;' }, 'التصنيف'),
                el('th', { style: 'width:8%;' }, 'الثقة'),
            )
        ));
        const tbody = el('tbody');
        accounts.forEach((a) => {
            const select = el('select', {
                onChange: async (e) => {
                    try {
                        toast('جاري إعادة التصنيف...', 'info');
                        const r = await api(`/api/reclassify/${state.currentJob}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ code: a.code, name: a.name, new_sub: e.target.value })
                        });
                        state.accounts = r.accounts;
                        toast('تم التحديث', 'success');
                        renderStatements();
                    } catch (err) {
                        toast('فشل: ' + err.message, 'error');
                    }
                }
            });
            subCategories.forEach((sc) => {
                const opt = el('option', { value: sc.value }, sc.label);
                if (sc.value === a.sub_category) opt.setAttribute('selected', 'selected');
                select.appendChild(opt);
            });
            const conf = a.confidence >= 0.8 ? el('span', { class: 'tag green' }, `${Math.round(a.confidence * 100)}%`)
                       : a.confidence >= 0.5 ? el('span', { class: 'tag blue' }, `${Math.round(a.confidence * 100)}%`)
                       : el('span', { class: 'tag red' }, `${Math.round(a.confidence * 100)}%`);
            const tr = el('tr', {},
                el('td', {}, a.code || '—'),
                el('td', {}, a.name),
                el('td', { class: 'amount' }, fmtAmount(a.debit)),
                el('td', { class: 'amount' }, fmtAmount(a.credit)),
                el('td', { class: 'amount' }, fmtAmount(a.balance)),
                el('td', {}, select),
                el('td', {}, conf)
            );
            tbody.appendChild(tr);
        });
        t.appendChild(tbody);
        wrap.appendChild(t);
        return wrap;
    }

    // ─── Notes view ───────────────────────────────────────
    async function renderNotes() {
        const main = $('#main-content');
        main.innerHTML = '';
        if (!state.currentJob) {
            main.appendChild(el('div', { class: 'empty' },
                el('div', { class: 'empty-icon' }, '∅'),
                el('div', { class: 'empty-title' }, 'لا توجد وظيفة محددة')
            ));
            return;
        }
        try {
            const r = await api(`/api/notes/${state.currentJob}`);
            if (!r.notes || r.notes.length === 0) {
                main.appendChild(el('div', { class: 'empty' },
                    el('div', { class: 'empty-icon' }, '∅'),
                    el('div', { class: 'empty-title' }, 'لا توجد إيضاحات بعد')
                ));
                return;
            }
            r.notes.forEach((n) => {
                const card = el('div', { class: 'section' });
                card.appendChild(el('div', { class: 'section-header' },
                    el('div', {},
                        el('div', { class: 'section-title' }, `إيضاح (${n.number}) — ${n.title}`),
                        el('div', { class: 'section-subtitle' }, n.body)
                    )
                ));
                if (n.accounts && n.accounts.length) {
                    const wrap = el('div', { class: 'table-wrap' });
                    const t = el('table', { class: 'statement' });
                    t.appendChild(el('thead', {},
                        el('tr', {},
                            el('th', { style: 'width:60%;' }, 'الحساب'),
                            el('th', { style: 'width:20%;' }, 'الرمز'),
                            el('th', { style: 'width:20%; text-align:left;' }, 'الرصيد')
                        )
                    ));
                    const tbody = el('tbody');
                    n.accounts.forEach((a) => {
                        tbody.appendChild(el('tr', {},
                            el('td', {}, a.name),
                            el('td', {}, a.code || '—'),
                            el('td', { class: 'amount' }, fmtAmount(a.amount))
                        ));
                    });
                    t.appendChild(tbody);
                    wrap.appendChild(t);
                    card.appendChild(wrap);
                }
                main.appendChild(card);
            });
        } catch (e) {
            main.appendChild(el('div', { class: 'empty' }, el('div', { class: 'empty-text' }, 'فشل تحميل الإيضاحات')));
        }
    }

    // ─── Compare view ─────────────────────────────────────
    async function renderCompare() {
        const main = $('#main-content');
        main.innerHTML = '';

        // Always refresh job list when entering compare view
        try {
            const r = await api('/api/jobs');
            state.jobs = r.jobs || [];
        } catch (e) { /* ignore */ }

        // Two selectors
        const ready = state.jobs.filter(j => j.status === 'ready');
        if (ready.length < 2) {
            main.appendChild(el('div', { class: 'empty' },
                el('div', { class: 'empty-icon' }, '⇄'),
                el('div', { class: 'empty-title' }, 'تحتاج فترتين على الأقل'),
                el('div', { class: 'empty-text' }, 'قم بتجهيز فترتين ماليتين على الأقل لإجراء المقارنة')
            ));
            return;
        }

        const sel1 = el('select', { onChange: (e) => { state.compare.current = e.target.value; } });
        const sel2 = el('select', { onChange: (e) => { state.compare.prior = e.target.value; } });
        ready.forEach((j) => {
            const lbl = `${j.filename} — ${j.period}`;
            sel1.appendChild(el('option', { value: j.job_id }, lbl));
            sel2.appendChild(el('option', { value: j.job_id }, lbl));
        });
        if (ready.length >= 2) {
            sel1.value = ready[0].job_id;
            sel2.value = ready[1].job_id;
            state.compare.current = ready[0].job_id;
            state.compare.prior = ready[1].job_id;
        }

        const section = el('div', { class: 'section' },
            el('div', { class: 'section-header' },
                el('div', {},
                    el('div', { class: 'section-title' }, 'اختر الفترات للمقارنة'),
                    el('div', { class: 'section-subtitle' }, 'قارن بين فترتين ماليتين')
                )
            ),
            el('div', { class: 'form-row' },
                el('div', { class: 'form-field' },
                    el('label', {}, 'الفترة الحالية'),
                    sel1
                ),
                el('div', { class: 'form-field' },
                    el('label', {}, 'الفترة السابقة'),
                    sel2
                ),
                el('div', { class: 'form-field' },
                    el('label', {}, ' '),
                    el('button', { class: 'btn btn-primary', onClick: runCompare }, '▶ تشغيل المقارنة')
                )
            )
        );
        main.appendChild(section);

        // Compare results area
        const result = el('div', { id: 'compare-results' });
        main.appendChild(result);

        // If previously chosen, auto-run
        if (state.compare.current && state.compare.prior && state.compare.current !== state.compare.prior) {
            runCompare();
        }
    }

    async function runCompare() {
        const result = $('#compare-results');
        if (!result) return;
        if (!state.compare.current || !state.compare.prior) {
            toast('اختر فترتين أولاً', 'warn');
            return;
        }
        if (state.compare.current === state.compare.prior) {
            toast('اختر فترتين مختلفتين', 'warn');
            return;
        }
        result.innerHTML = '<div class="empty"><div class="spinner"></div></div>';
        try {
            const r = await api('/api/compare', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    job_current: state.compare.current,
                    job_prior: state.compare.prior,
                })
            });
            renderCompareResult(r, result);
        } catch (e) {
            result.innerHTML = '';
            toast('فشل: ' + e.message, 'error');
        }
    }

    function renderCompareResult(r, container) {
        container.innerHTML = '';
        // KPIs
        const kpiCard = el('div', { class: 'section' });
        kpiCard.appendChild(el('div', { class: 'section-title', style: 'margin-bottom:16px;' }, 'المؤشرات الرئيسية'));
        const kpiRow = el('div', { class: 'cards' });
        r.kpis.forEach((k) => {
            const color = k.change > 0 ? 'green' : (k.change < 0 ? 'red' : 'gray');
            const arrow = k.change > 0 ? '↑' : (k.change < 0 ? '↓' : '→');
            kpiRow.appendChild(el('div', { class: 'card' },
                el('div', { class: 'card-icon' }, arrow),
                el('div', { class: 'card-body' },
                    el('div', { class: 'card-label' }, k.name),
                    el('div', { class: 'card-value' }, fmtAmount(k.current)),
                    el('div', { style: 'font-size:12px; color:' + (color === 'green' ? '#065F46' : (color === 'red' ? '#991B1B' : '#475569')) + '; margin-top:4px;' },
                        `${fmtAmount(k.change)} (${fmtPct(k.pct_change)})`
                    )
                )
            ));
        });
        kpiCard.appendChild(kpiRow);
        container.appendChild(kpiCard);

        // Per-statement comparison tables
        const titles = {
            'balance_sheet': 'قائمة المركز المالي - مقارنة',
            'income_statement': 'قائمة الدخل - مقارنة',
            'cash_flow': 'التدفقات النقدية - مقارنة',
            'equity': 'حقوق الملكية - مقارنة',
        };
        Object.entries(r.comparisons).forEach(([key, rows]) => {
            const card = el('div', { class: 'section' });
            card.appendChild(el('div', { class: 'section-title', style: 'margin-bottom:16px;' }, titles[key] || key));
            const wrap = el('div', { class: 'table-wrap' });
            const t = el('table', { class: 'statement' });
            t.appendChild(el('thead', {},
                el('tr', {},
                    el('th', {}, 'البيان'),
                    el('th', { style: 'text-align:left;' }, 'الفترة الحالية'),
                    el('th', { style: 'text-align:left;' }, 'الفترة السابقة'),
                    el('th', { style: 'text-align:left;' }, 'التغير'),
                    el('th', { style: 'text-align:left;' }, 'نسبة %')
                )
            ));
            const tbody = el('tbody');
            rows.forEach((line) => {
                const classes = [];
                if (line.is_subtotal) classes.push('subtotal');
                if (line.is_total) classes.push('total');
                if (line.indent > 0) classes.push(`indent-${Math.min(line.indent, 2)}`);
                tbody.appendChild(el('tr', { class: classes.join(' ') },
                    el('td', {}, line.label),
                    el('td', { class: 'amount' }, fmtAmount(line.current)),
                    el('td', { class: 'amount' }, fmtAmount(line.prior)),
                    el('td', { class: 'amount' }, fmtAmount(line.change)),
                    el('td', { class: 'amount' }, line.pct_change != null ? fmtPct(line.pct_change) : '—')
                ));
            });
            t.appendChild(tbody);
            wrap.appendChild(t);
            card.appendChild(wrap);
            container.appendChild(card);
        });
    }

    // ─── Export ───────────────────────────────────────────
    async function exportFile(fmt, jobId = null) {
        jobId = jobId || state.currentJob;
        if (!jobId) { toast('لا توجد وظيفة للتصدير', 'warn'); return; }
        const f = fmt === 'xlsx' ? 'xlsx' : 'pdf';
        try {
            const res = await fetch(`/api/export/${f}/${jobId}`);
            if (!res.ok) throw new Error(await res.text());
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = el('a', { href: url, download: '' });
            a.download = res.headers.get('content-disposition')?.match(/filename="?(.+?)"?$/)?.[1] || `financial_${f}.${f}`;
            document.body.appendChild(a); a.click(); a.remove();
            URL.revokeObjectURL(url);
            toast('تم التصدير', 'success');
        } catch (e) {
            toast('فشل التصدير: ' + e.message, 'error');
        }
    }

    async function exportCompare(fmt) {
        if (!state.compare.current || !state.compare.prior) {
            toast('لا توجد مقارنة', 'warn');
            return;
        }
        const f = fmt === 'xlsx' ? 'xlsx' : 'pdf';
        try {
            const url = `/api/compare/export/${f}?job_current=${state.compare.current}&job_prior=${state.compare.prior}&company=${encodeURIComponent(state.company)}&period_current=${encodeURIComponent(state.period)}&period_prior=الفترة السابقة`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(await res.text());
            const blob = await res.blob();
            const u = URL.createObjectURL(blob);
            const a = el('a', { href: u, download: '' });
            a.download = `comparison.${f}`;
            document.body.appendChild(a); a.click(); a.remove();
            URL.revokeObjectURL(u);
            toast('تم تصدير المقارنة', 'success');
        } catch (e) {
            toast('فشل: ' + e.message, 'error');
        }
    }

    // ─── Modal ────────────────────────────────────────────
    function openModal(title, body) {
        const bg = el('div', { class: 'modal-bg open' });
        const m = el('div', { class: 'modal' },
            el('div', { class: 'modal-header' },
                el('h3', {}, title),
                el('button', { class: 'modal-close', onClick: () => bg.remove() }, '×')
            ),
            body
        );
        bg.appendChild(m);
        bg.addEventListener('click', (e) => { if (e.target === bg) bg.remove(); });
        document.body.appendChild(bg);
    }

    // ─── Init ─────────────────────────────────────────────
    async function init() {
        setupNav();
        try {
            const r = await api('/api/jobs');
            state.jobs = r.jobs || [];
        } catch (e) { /* ignore */ }
        switchView('dashboard');
    }

    return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
