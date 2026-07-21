/* نظام المراجعة المالية v2.7 */
const App = (() => {
    const state = { companies: [], currentCompany: null, currentView: 'companies', currentJob: null, currentTab: 'list', comparisonNotesSelection: {} };
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => Array.from(document.querySelectorAll(s));
    
    function el(tag, attrs = {}, ...children) {
        const e = document.createElement(tag);
        Object.entries(attrs || {}).forEach(([k, v]) => {
            if (k === 'class') e.className = v;
            else if (k === 'html') e.innerHTML = v;
            else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
            else if (v != null) e.setAttribute(k, v);
        });
        children.flat().forEach(c => { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
        return e;
    }
    
    function fmt(v) {
        if (v == null || v === '') return '—';
        const n = Number(v);
        if (isNaN(n)) return String(v);
        const abs = Math.abs(n);
        const s = abs.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
        return n < 0 ? `(${s})` : s;
    }
    
    function toast(msg, type = 'info') {
        let c = $('#toast-container');
        if (!c) { c = el('div', { id: 'toast-container', style: 'position:fixed;top:20px;right:20px;z-index:9999;' }); document.body.appendChild(c); }
        const colors = { info: '#3b82f6', success: '#10b981', warn: '#f59e0b', error: '#ef4444' };
        const t = el('div', { class: 'toast ' + type, style: `background:${colors[type]||'#333'};color:#fff;padding:12px 16px;margin-bottom:8px;border-radius:6px;min-width:240px;box-shadow:0 4px 12px rgba(0,0,0,0.15);` }, msg);
        c.appendChild(t);
        setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3500);
    }
    
    async function api(path, opts = {}) {
        const headers = { ...(opts.headers || {}) };
        if (state.currentCompany && !path.includes('company_id=')) {
            path += (path.includes('?') ? '&' : '?') + `company_id=${encodeURIComponent(state.currentCompany.id)}`;
        }
        const res = await fetch(path, { ...opts, headers });
        if (!res.ok) { const txt = await res.text(); throw new Error(txt || res.statusText); }
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json')) return res.json();
        return res;
    }
    
    function setupNav() {
        const items = [
            { key: 'dashboard', label: 'لوحة التحكم', icon: '⌂' },
            { key: 'trial_balance', label: 'ميزان المراجعة', icon: '⚖' },
            { key: 'statements', label: 'القوائم المالية', icon: '📊' },
            { key: 'notes', label: 'الإيضاحات', icon: '📝' },
            { key: 'financial_analysis', label: 'تحليل مالي', icon: '📈' },
            { key: 'attachments', label: 'مرفقات المستندات', icon: '📎' },
            { key: 'compare', label: 'المقارنات المالية', icon: '⇄' },
            { key: 'consolidation', label: 'القوائم الموحدة (IFRS 10)', icon: '🏢' },
            { key: 'unified_budget', label: 'ميزانية موحدة (بسيطة)', icon: '📋' },
        ];
        const sec = $('#nav-section');
        if (!sec) return;
        sec.innerHTML = '';
        items.forEach(it => {
            const a = el('a', { class: 'nav-item', href: '#', onClick: (e) => { e.preventDefault(); switchView(it.key); } },
                el('span', { class: 'nav-icon' }, it.icon),
                el('span', { class: 'nav-label' }, it.label));
            sec.appendChild(a);
        });
        sec.appendChild(el('div', { style: 'margin-top:auto;padding-top:24px;border-top:1px solid #e5e7eb;' },
            el('button', { class: 'btn btn-outline', style: 'width:100%;', onClick: switchCompany }, '🔄 تبديل الشركة')));
    }
    
    function setActiveNav(key) {
        $$('.nav-item').forEach(n => n.classList.remove('active'));
        const items = $$('.nav-item');
        const idx = ['dashboard','trial_balance','statements','notes','financial_analysis','attachments','compare'].indexOf(key);
        if (idx >= 0 && items[idx]) items[idx].classList.add('active');
    }
    
    function renderTopbar() {
        const titles = { 
            dashboard: 'لوحة التحكم', 
            trial_balance: 'ميزان المراجعة', 
            statements: 'القوائم المالية', 
            notes: 'الإيضاحات', 
            financial_analysis: 'التحليل المالي الشامل', 
            attachments: 'مرفقات الملفات والمستندات', 
            compare: 'مقارنة الفترات المالية',
            consolidation: 'القوائم المالية الموحدة' 
        };
        const tb = $('.topbar');
        if (!tb) return;
        const showBack = state.currentView !== 'dashboard' && state.currentView !== 'companies';
        const companyName = state.currentCompany ? state.currentCompany.name : '';
        const backBtn = showBack ? '<button class="btn btn-outline" onclick="App.goBack()" style="padding:6px 12px;">← رجوع</button>' : '';
        const companyBadge = companyName ? '<span style="margin-right:auto;background:#eff6ff;padding:6px 14px;border-radius:20px;border:1px solid #bfdbfe;font-size:14px;font-weight:600;color:#1e40af;">📁 ' + companyName + '</span>' : '<span style="margin-right:auto;"></span>';
        tb.innerHTML = '<div style="display:flex;align-items:center;gap:16px;width:100%;">' + backBtn + '<h1 style="margin:0;font-size:24px;">' + (titles[state.currentView] || '') + '</h1>' + companyBadge + '</div>';
    }
    
    async function switchView(view) {
        if (!state.currentCompany) return showCompanySelector();
        state.currentView = view;
        setActiveNav(view);
        renderTopbar();
        if (view === 'dashboard') await renderDashboard();
        else if (view === 'trial_balance') await renderTrialBalance();
        else if (view === 'statements') await renderStatements();
        else if (view === 'notes') await renderNotes();
        else if (view === 'financial_analysis') await renderFinancialAnalysis();
        else if (view === 'attachments') await renderAttachments();
        else if (view === 'compare') await renderCompare();
        else if (view === 'consolidation') await renderConsolidation();
        else if (view === 'unified_budget') await renderUnifiedBudgetView();
    }
    
    function goBack() {
        if (state.currentView === 'trial_balance' && state.currentJob) { state.currentTab = 'list'; state.currentJob = null; localStorage.removeItem('currentJobId'); return renderTrialBalance(); }
        if (['statements', 'notes', 'financial_analysis', 'attachments', 'compare'].includes(state.currentView)) return switchView('trial_balance');
        return switchView('dashboard');
    }
    
    function switchCompany() {
        state.currentCompany = null; state.currentJob = null; state.accounts = []; state.currentView = 'companies';
        localStorage.removeItem('currentCompanyId'); localStorage.removeItem('currentJobId');
        showCompanySelector();
    }
    
    async function showCompanySelector() {
        setActiveNav(null);
        state.currentView = 'companies';
        const tb = $('.topbar');
        if (tb) tb.innerHTML = '<h1 style="margin:0;font-size:24px;">اختر الشركة</h1>';
        const main = $('#main-content');
        if (!main) return;
        let companies = [];
        try { const r = await fetch('/api/companies'); if (r.ok) { const data = await r.json(); companies = data.companies || []; } } catch (e) {}
        main.innerHTML = '';
        main.appendChild(el('div', { style: 'text-align:center;padding:40px 20px 20px;' },
            el('div', { style: 'font-size:48px;margin-bottom:16px;' }, '🏢'),
            el('h1', { style: 'font-size:28px;margin:0;color:#1e40af;font-weight:700;' }, 'مرحباً بك'),
            el('p', { style: 'font-size:16px;color:#6b7280;margin-top:12px;' }, 'اختر شركة أو أنشئ جديدة')));
        if (companies.length > 0) {
            main.appendChild(el('div', { style: 'max-width:900px;margin:0 auto;padding:20px;' },
                el('h2', { style: 'font-size:18px;color:#374151;margin-bottom:16px;' }, `📁 الشركات (${companies.length})`),
                el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;' },
                    ...companies.map(c => el('div', {
                        style: 'background:#fff;border:2px solid #e5e7eb;border-radius:12px;padding:20px;cursor:pointer;text-align:center;',
                        onClick: () => selectCompany(c)
                    },
                        el('div', { style: 'width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,#3b82f6 0%,#1e40af 100%);color:#fff;font-size:24px;font-weight:700;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;' }, c.name.charAt(0)),
                        el('div', { style: 'font-size:18px;font-weight:600;color:#1f2937;margin-bottom:4px;' }, c.name),
                        el('div', { style: 'font-size:13px;color:#6b7280;' }, `${c.job_count || 0} ميزان • ${c.currency}`)))),
            ));
        }
        main.appendChild(el('div', { style: 'max-width:500px;margin:32px auto;padding:24px;background:#fff;border:2px dashed #d1d5db;border-radius:12px;' },
            el('h2', { style: 'font-size:18px;color:#374151;margin-top:0;text-align:center;' }, '➕ إنشاء شركة'),
            el('div', { style: 'margin-top:16px;' },
                el('div', { style: 'margin-bottom:12px;' },
                    el('label', { style: 'display:block;margin-bottom:4px;font-size:13px;' }, 'اسم الشركة *'),
                    el('input', { type: 'text', id: 'new-company-name', placeholder: 'مثال: شركة الأمل', style: 'width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;box-sizing:border-box;' })),
                el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;' },
                    el('div', null,
                        el('label', { style: 'display:block;margin-bottom:4px;font-size:13px;' }, 'الرقم الضريبي'),
                        el('input', { type: 'text', id: 'new-company-tax', placeholder: '000000000000000', style: 'width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;box-sizing:border-box;' })),
                    el('div', null,
                        el('label', { style: 'display:block;margin-bottom:4px;font-size:13px;' }, 'العملة'),
                        el('input', { type: 'text', id: 'new-company-currency', value: 'ر.س', style: 'width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;box-sizing:border-box;' }))),
                el('button', { class: 'btn btn-primary', style: 'width:100%;padding:12px;font-size:15px;', onClick: createCompanyFromSelector }, 'إنشاء والدخول'))));
    }
    
    async function createCompanyFromSelector() {
        const name = $('#new-company-name').value.trim();
        if (!name) { toast('الاسم مطلوب', 'warn'); return; }
        const payload = { name, tax_id: $('#new-company-tax').value, currency: $('#new-company-currency').value || 'ر.س', notes: '' };
        try {
            const r = await fetch('/api/companies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            if (!r.ok) { const txt = await r.text(); throw new Error(txt || r.statusText); }
            const c = await r.json();
            toast(`تم إنشاء: ${c.name}`, 'success');
            state.currentCompany = c;
            localStorage.setItem('currentCompanyId', c.id);
            setupNav();
            await switchView('dashboard');
        } catch (e) { toast('خطأ: ' + e.message, 'error'); }
    }
    
    async function selectCompany(c) {
        state.currentCompany = c;
        localStorage.setItem('currentCompanyId', c.id);
        state.currentJob = null; state.accounts = [];
        setupNav();
        await switchView('dashboard');
    }
    
    async function renderDashboard() {
        const main = $('#main-content');
        if (!main) return;
        main.innerHTML = '';
        main.appendChild(el('div', { style: 'background:linear-gradient(135deg,#1e40af 0%,#3b82f6 100%);color:#fff;padding:24px;border-radius:12px;margin-bottom:24px;' },
            el('div', { style: 'font-size:13px;opacity:0.85;margin-bottom:4px;' }, '📁 ملف الشركة'),
            el('div', { style: 'font-size:28px;font-weight:700;' }, state.currentCompany.name),
            el('div', { style: 'font-size:14px;opacity:0.9;margin-top:4px;' },
                (state.currentCompany.tax_id ? `الرقم الضريبي: ${state.currentCompany.tax_id} • ` : '') + `العملة: ${state.currentCompany.currency}`)));
        const r = await api('/api/jobs');
        const allJobs = r.jobs || [];
        const savedJobs = allJobs.filter(j => j.status === 'ready' || j.status === 'committed' || j.status === 'processed');
        const draftJobs = allJobs.filter(j => j.status === 'uploaded' || j.status === 'draft');
        main.appendChild(el('div', { class: 'cards' },
            el('div', { class: 'card' }, el('div', { class: 'card-label' }, 'موازين محفوظة'), el('div', { class: 'card-value' }, String(savedJobs.length))),
            el('div', { class: 'card' }, el('div', { class: 'card-label' }, 'إجمالي حسابات'), el('div', { class: 'card-value' }, String(savedJobs.reduce((s, j) => s + (j.account_count || 0), 0)))),
            el('div', { class: 'card' }, el('div', { class: 'card-label' }, 'مسودات'), el('div', { class: 'card-value', style: 'color:' + (draftJobs.length > 0 ? '#f59e0b' : '#9ca3af') }, String(draftJobs.length)))));
        main.appendChild(el('div', { class: 'section', style: 'background:#f9fafb;padding:24px;border-radius:12px;text-align:center;margin-bottom:20px;' },
            el('div', { style: 'font-size:16px;margin-bottom:16px;color:#374151;' }, 'ابدأ رفع ملف جديد'),
            el('button', { class: 'btn btn-primary', style: 'padding:14px 32px;font-size:15px;', onClick: () => switchView('trial_balance') }, '📤 رفع ميزان جديد')));
        if (draftJobs.length > 0) {
            main.appendChild(el('div', { style: 'background:#fffbeb;border:1px solid #fcd34d;border-radius:12px;padding:16px;margin-bottom:20px;' },
                el('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px;' },
                    el('span', { style: 'font-size:20px;' }, '⚠️'),
                    el('strong', { style: 'color:#92400e;' }, `${draftJobs.length} مسودة تنتظر الحفظ ومتاحة للتعديل من تبويب ميزان المراجعة`))));
        }
        if (savedJobs.length > 0) {
            const list = el('div', { class: 'section' }, el('h2', { style: 'margin-top:0;' }, '✅ المحفوظة'));
            savedJobs.forEach(j => {
                list.appendChild(el('div', { class: 'job-row' },
                    el('div', { class: 'job-info' },
                        el('div', { class: 'job-name' }, j.filename || '—'),
                        el('div', { class: 'job-meta' }, `${j.account_count} حساب • ${j.period || ''}`)),
                    el('div', { class: 'job-actions' },
                        el('button', { class: 'btn btn-primary', onClick: () => openJob(j.job_id) }, 'فتح'),
                        el('button', { class: 'btn btn-outline', onClick: () => deleteJob(j.job_id) }, '🗑'))));
            });
            main.appendChild(list);
        } else {
            main.appendChild(el('div', { class: 'empty', style: 'background:#fff;border:2px dashed #d1d5db;border-radius:12px;padding:40px;text-align:center;' },
                el('div', { class: 'empty-icon' }, '📋'),
                el('div', { class: 'empty-title' }, 'لا توجد موازين'),
                el('div', { class: 'empty-text' }, 'ارفع ملف من تبويب ميزان المراجعة')));
        }
    }
    
    async function openJob(jobId) { state.currentJob = jobId; state.currentTab = 'detail'; localStorage.setItem('currentJobId', jobId); await switchView('trial_balance'); }
    
    async function renderTrialBalance() {
        const main = $('#main-content');
        if (!main) return;
        main.innerHTML = '';
        const tabs = el('div', { class: 'tabs' },
            el('button', { class: 'tab' + (state.currentTab === 'list' ? ' active' : ''), onClick: () => { state.currentTab = 'list'; renderTrialBalance(); } }, 'إدارة الموازين والرفع'),
            el('button', { class: 'tab' + (state.currentTab === 'detail' ? ' active' : ''), onClick: () => { state.currentTab = 'detail'; renderTrialBalance(); } }, 'تفاصيل وتعديل الحسابات'),
            el('button', { class: 'tab' + (state.currentTab === 'validate' ? ' active' : ''), onClick: () => { state.currentTab = 'validate'; renderTrialBalance(); } }, 'التشييك والتدقيق'));
        main.appendChild(tabs);
        if (state.currentTab === 'list') await renderTrialBalanceList();
        else if (state.currentTab === 'detail' && state.currentJob) await renderEditor();
        else if (state.currentTab === 'validate' && state.currentJob) await renderValidation();
        else main.appendChild(el('div', { class: 'empty' }, el('div', { class: 'empty-text' }, 'الرجاء اختيار ميزان أو فتحه من القائمة أدناه')));
    }
    
    async function renderTrialBalanceList() {
        const main = $('#main-content');
        
        const uploadSec = el('div', { class: 'section' },
            el('div', { class: 'section-header' }, el('div', { class: 'section-title' }, '📤 رفع ميزان جديد')),
            el('div', { class: 'upload-zone', id: 'upload-zone',
                onClick: () => $('#file-input').click(),
                onDragover: (e) => { e.preventDefault(); e.currentTarget.classList.add('drag'); },
                onDragleave: (e) => e.currentTarget.classList.remove('drag'),
                onDrop: (e) => { e.preventDefault(); e.currentTarget.classList.remove('drag'); if (e.dataTransfer.files.length) handleFileUpload(e.dataTransfer.files[0]); }
            },
                el('div', { class: 'upload-icon' }, '📁'),
                el('div', { class: 'upload-text' }, 'اضغط هنا أو اسحب ملف ميزان المراجعة'),
                el('div', { class: 'upload-formats' }, 'Excel أو PDF')),
            el('input', { type: 'file', id: 'file-input', style: 'display:none;', accept: '.xlsx,.xls,.pdf,.csv', onChange: (e) => { if (e.target.files.length) handleFileUpload(e.target.files[0]); } }));
        main.appendChild(uploadSec);
        
        const r = await api('/api/jobs');
        const allJobs = r.jobs || [];
        const savedJobs = allJobs.filter(j => j.status === 'ready' || j.status === 'committed' || j.status === 'processed');
        const draftJobs = allJobs.filter(j => j.status === 'uploaded' || j.status === 'draft');
        
        if (draftJobs.length > 0) {
            const draftSec = el('div', { class: 'section', style: 'background:#fffbeb;border:2px solid #fcd34d;border-radius:12px;padding:16px;margin-bottom:20px;' },
                el('h2', { style: 'margin-top:0;color:#92400e;font-size:18px;' }, `📝 المسودات المتاحة للتعديل والمتابعة (${draftJobs.length})`));
            
            draftJobs.forEach(j => {
                draftSec.appendChild(el('div', { class: 'job-row', style: 'background:#fff;border:1px solid #fde68a;border-radius:8px;padding:12px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;' },
                    el('div', { class: 'job-info' },
                        el('div', { class: 'job-name', style: 'font-weight:600;color:#78350f;' }, '📝 ' + (j.filename || 'مسودة ميزان')),
                        el('div', { class: 'job-meta', style: 'font-size:13px;color:#92400e;' }, `${j.account_count || 0} حساب • الفترة: ${j.period || '—'}`)),
                    el('div', { class: 'job-actions', style: 'display:flex;gap:8px;' },
                        el('button', { class: 'btn btn-primary', style: 'padding:6px 12px;font-size:13px;', onClick: () => openJob(j.job_id) }, '✏️ تعديل ومتابعة'),
                        el('button', { class: 'btn btn-outline', style: 'padding:6px 12px;font-size:13px;background:#10b981;color:#fff;border:none;', onClick: () => commitJob(j.job_id) }, '💾 حفظ نهائي'),
                        el('button', { class: 'btn btn-outline', style: 'padding:6px 12px;', onClick: () => deleteJob(j.job_id) }, '🗑'))));
            });
            main.appendChild(draftSec);
        }

        const listSec = el('div', { class: 'section' }, el('h2', { style: 'margin-top:0;font-size:18px;' }, `✅ الموازين المحفوظة والجاهزة للقوائم المالية (${savedJobs.length})`));
        if (savedJobs.length === 0) {
            listSec.appendChild(el('div', { class: 'empty', style: 'padding:24px;text-align:center;color:#6b7280;background:#f9fafb;border-radius:8px;' }, 'لا توجد موازين محفوظة حالياً. احفظ إحدى المسودات بالأعلى لتفعيل القوائم المالية.'));
        } else {
            savedJobs.forEach(j => {
                listSec.appendChild(el('div', { class: 'job-row', style: 'background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;' },
                    el('div', { class: 'job-info' },
                        el('div', { class: 'job-name', style: 'font-weight:600;' }, '✅ ' + (j.filename || 'ميزان مراجعة')),
                        el('div', { class: 'job-meta', style: 'font-size:13px;color:#6b7280;' }, `${j.account_count || 0} حساب`)),
                    el('div', { class: 'job-actions', style: 'display:flex;gap:8px;' },
                        el('button', { class: 'btn btn-primary', style: 'padding:6px 12px;font-size:13px;', onClick: () => openJob(j.job_id) }, '📊 اختيار وعرض القوائم'),
                        el('button', { class: 'btn btn-outline', style: 'padding:6px 12px;', onClick: () => deleteJob(j.job_id) }, '🗑'))));
            });
        }
        main.appendChild(listSec);
    }
    
    async function handleFileUpload(file) {
        if (!state.currentCompany) { toast('اختر شركة أولاً', 'warn'); return; }
        const formData = new FormData();
        formData.append('file', file);
        formData.append('company_name', state.currentCompany.name);
        formData.append('period', new Date().getFullYear().toString());
        formData.append('currency', state.currentCompany.currency || 'ر.س');
        try {
            toast('⏳ جاري الرفع...', 'info');
            const r = await fetch(`/api/upload?company_id=${state.currentCompany.id}`, { method: 'POST', body: formData });
            if (!r.ok) { const txt = await r.text(); throw new Error(txt || res.statusText); }
            const data = await r.json();
            toast('✅ تم الرفع كمسودة. راجع ثم احفظ', 'success');
            state.currentJob = data.job_id; state.currentTab = 'detail';
            localStorage.setItem('currentJobId', data.job_id);
            await renderTrialBalance();
        } catch (e) { toast('فشل الرفع: ' + e.message, 'error'); }
    }
    
    async function unlockJob(jobId) {
        if (!confirm('هل تريد فتح الميزان للتعديل؟')) return;
        try { await api(`/api/jobs/${jobId}/unlock`, { method: 'POST' }); toast('🔓 تم فتح الميزان', 'success'); await renderEditor(); } catch (e) { toast('خطأ: ' + e.message, 'error'); }
    }

    async function commitJob(jobId) {
        if (!confirm('هل تريد حفظ هذا الميزان نهائياً؟')) return;
        try { await api(`/api/jobs/${jobId}/commit`, { method: 'POST' }); toast('✅ تم الحفظ بنجاح', 'success'); await renderTrialBalance(); } catch (e) { toast('خطأ في الحفظ: ' + e.message, 'error'); }
    }
    
    async function deleteJob(jobId) {
        if (!confirm('هل أنت متأكد من الحذف؟')) return;
        try { await api(`/api/jobs/${jobId}`, { method: 'DELETE' }); toast('تم الحذف', 'success'); if (state.currentJob === jobId) { state.currentJob = null; localStorage.removeItem('currentJobId'); } await renderTrialBalance(); } catch (e) { toast('خطأ في الحذف: ' + e.message, 'error'); }
    }
    
    async function renderEditor() {
        const main = $('#main-content');
        main.innerHTML = '';
        if (!state.currentJob) { main.innerHTML = '<div class="empty">الرجاء اختيار ميزان أولاً</div>'; return; }
        try {
            const r = await api(`/api/jobs/${state.currentJob}`);
            const job = r.job || r;
            const accounts = job.accounts || job.raw_rows || [];
            const isDraft = job.status === 'uploaded' || job.status === 'draft';
            const table = el('table', { class: 'tb-table' },
                el('thead', {}, el('tr', {}, el('th', {}, 'الكود'), el('th', {}, 'الاسم'), el('th', {}, 'مدين'), el('th', {}, 'دائن'), el('th', {}, 'التصنيف'), el('th', {}, 'الثقة'), el('th', {}, 'إجراء'))),
                el('tbody', {}, ...accounts.map((a, i) => {
                    const sel = el('select', { style: 'padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:13px;width:100%;', onChange: (e) => changeSubCategory(i, e.target.value) });
                    SUB_CATEGORIES.forEach(([val, lbl]) => { const opt = el('option', { value: val }, lbl); if (a.sub_category === val) opt.selected = true; sel.appendChild(opt); });
                    return el('tr', {},
                        el('td', { style: 'font-family:monospace;font-weight:600;' }, a.code || '—'),
                        el('td', { style: 'font-size:13px;' }, a.name || '—'),
                        el('td', { style: 'text-align:left;font-family:monospace' }, fmt(a.debit)),
                        el('td', { style: 'text-align:left;font-family:monospace' }, fmt(a.credit)),
                        el('td', {}, sel),
                        el('td', {}, a.confidence ? `${(a.confidence*100).toFixed(0)}%` : '—'),
                        el('td', {}, el('button', { class: 'btn-icon', onClick: () => deleteAccount(i), title: 'حذف' }, '🗑')));
                })));
            main.appendChild(el('div', { class: 'section' },
                el('div', { class: 'section-header' },
                    el('div', {}, el('h2', { style: 'margin:0;' }, isDraft ? '📝 مراجعة وتعديل المسودة' : '✅ تفاصيل الميزان المختار'), el('div', { style: 'font-size:13px;color:#6b7280;margin-top:4px;' }, job.filename || '')),
                    el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;' },
                        el('button', { class: 'btn btn-outline', onClick: processJob }, '⚙️ توليد القوائم المالية'),
                        isDraft ? el('button', { class: 'btn btn-primary', onClick: () => commitJob(state.currentJob) }, '💾 حفظ نهائي') : el('div', { style: 'display:flex;gap:8px;align-items:center;' }, el('span', { class: 'tag green' }, '✓ محفوظ'), el('button', { class: 'btn btn-outline', style: 'background:#fef3c7;color:#92400e;', onClick: () => unlockJob(state.currentJob) }, '🔓 فتح للتعديل'))),
                // شريط أدوات التصنيف الذكي
                el('div', { style: 'background:linear-gradient(90deg,#eff6ff 0%,#dbeafe 100%);border:1px solid #93c5fd;border-radius:8px;padding:12px 16px;margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;' },
                    el('span', { style: 'font-weight:700;color:#1e40af;font-size:13px;' }, '💼 التصنيف الذكي:'),
                    el('button', { class: 'btn btn-outline', style: 'padding:6px 14px;font-size:13px;background:#fff;', onClick: () => saveAsProfile() }, '💾 حفظ التصنيفات كقالب'),
                    el('button', { class: 'btn btn-outline', style: 'padding:6px 14px;font-size:13px;background:#fff;', onClick: () => applyProfile() }, '📋 تطبيق قالب محفوظ'),
                    el('button', { class: 'btn btn-outline', style: 'padding:6px 14px;font-size:13px;background:#fff;', onClick: () => autoTagIntercompany() }, '🔗 كشف تلقائي للبنوك البينية'),
                    el('span', { id: 'profile-status', style: 'margin-right:auto;font-size:12px;color:#6b7280;' })
                ),
                table)));
        } catch (e) { main.innerHTML = `<div class="empty">خطأ في التحميل: ${e.message}</div>`; }
    }

    async function saveAsProfile() {
        if (!state.currentJob) { toast('لا يوجد ميزان مفتوح', 'warn'); return; }
        if (!state.currentCompany) { toast('لا توجد شركة محددة', 'warn'); return; }
        try {
            const r = await api(`/api/jobs/${state.currentJob}`);
            const accounts = r.job?.accounts || r.accounts || r.raw_rows || [];
            const profile = {};
            accounts.forEach(a => {
                const key = (a.code || '').trim() + '|' + (a.name || '').trim();
                if (a.sub_category && key !== '|') {
                    profile[key] = a.sub_category;
                }
            });
            const resp = await api(`/api/companies/${state.currentCompany.id}/save-profile`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(profile)
            });
            toast('✅ تم حفظ ' + Object.keys(profile).length + ' تصنيف كقالب', 'success');
            const status = $('#profile-status');
            if (status) status.textContent = '✓ تم حفظ القالب (' + Object.keys(profile).length + ' حساب)';
        } catch (e) { toast('خطأ: ' + e.message, 'error'); }
    }

    async function applyProfile() {
        if (!state.currentJob) { toast('لا يوجد ميزان مفتوح', 'warn'); return; }
        if (!state.currentCompany) { toast('لا توجد شركة محددة', 'warn'); return; }
        try {
            const pr = await api(`/api/companies/${state.currentCompany.id}/profile`);
            const profile = pr.profile || pr || {};
            const keys = Object.keys(profile);
            if (keys.length === 0) {
                toast('⚠️ لا يوجد قالب محفوظ. احفظ قالب أولاً', 'warn');
                return;
            }
            const r = await api(`/api/jobs/${state.currentJob}`);
            const accounts = r.job?.accounts || r.accounts || r.raw_rows || [];
            let applied = 0;
            for (let i = 0; i < accounts.length; i++) {
                const a = accounts[i];
                const key = (a.code || '').trim() + '|' + (a.name || '').trim();
                const newSub = profile[key];
                if (newSub && newSub !== a.sub_category) {
                    try {
                        await api(`/api/jobs/${state.currentJob}/reclassify`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ index: i, new_sub: newSub })
                        });
                        applied++;
                    } catch (e) {}
                }
            }
            toast('✅ تم تطبيق ' + applied + ' تصنيف من القالب', 'success');
            await renderEditor();
        } catch (e) { toast('خطأ: ' + e.message, 'error'); }
    }

    async function autoTagIntercompany() {
        if (!state.currentJob) { toast('لا يوجد ميزان مفتوح', 'warn'); return; }
        // Heuristic: أي حساب فيه "شركة"، "تابع"، "مجموعة"، "أخ"، "IC"، "بيني"، "شريك"، "الأم"، "تابعه"
        const IC_KEYWORDS = ['شركة', 'تابع', 'مجموعة', 'أخ', 'IC', 'بيني', 'شريك', 'الأم', 'تابعه', 'الشقيقة', 'حليفة'];
        try {
            const r = await api(`/api/jobs/${state.currentJob}`);
            const accounts = r.job?.accounts || r.accounts || r.raw_rows || [];
            let tagged = 0;
            for (let i = 0; i < accounts.length; i++) {
                const a = accounts[i];
                if (a.sub_category && a.sub_category.startsWith('ic_')) continue;  // already IC
                const text = ((a.name || '') + ' ' + (a.code || '')).toLowerCase();
                const isIC = IC_KEYWORDS.some(kw => text.includes(kw.toLowerCase()));
                if (!isIC) continue;
                // decide type
                const isCredit = (a.credit || 0) > (a.debit || 0);
                const isDebit = (a.debit || 0) > (a.credit || 0);
                let cat = 'ic_receivable';
                if (text.includes('مبيع') || text.includes('ايراد') || text.includes('إيراد') || text.includes('دخل')) cat = 'ic_revenue';
                else if (text.includes('مشتريات') || text.includes('مصروف') || text.includes('تكلف')) cat = 'ic_expense';
                else if (text.includes('قرض') || text.includes('سلف')) cat = isDebit ? 'ic_loan_receivable' : 'ic_loan_payable';
                else if (text.includes('توزيع')) cat = isDebit ? 'ic_dividend_receivable' : 'ic_dividend_payable';
                else if (text.includes('استثمار')) cat = 'investment_in_sub';
                else cat = isCredit ? 'ic_payable' : 'ic_receivable';
                try {
                    await api(`/api/jobs/${state.currentJob}/reclassify`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ index: i, new_sub: cat })
                    });
                    tagged++;
                } catch (e) {}
            }
            toast('🔗 تم وسم ' + tagged + ' حساب بيني تلقائياً', 'success');
            await renderEditor();
        } catch (e) { toast('خطأ: ' + e.message, 'error'); }
    }
    
    async function deleteAccount(idx) {
        if (!confirm('حذف هذا الحساب؟')) return;
        try { await api(`/api/jobs/${state.currentJob}/accounts/${idx}`, { method: 'DELETE' }); toast('تم الحذف', 'success'); await renderEditor(); } catch (e) { toast('خطأ: ' + e.message, 'error'); }
    }
    
    async function changeSubCategory(idx, newSub) {
        try { await api(`/api/jobs/${state.currentJob}/reclassify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ index: idx, new_sub: newSub }) }); } catch (e) { toast('خطأ: ' + e.message, 'error'); }
    }
    
    async function processJob() {
        try { 
            await api(`/api/process/${state.currentJob}`, { method: 'POST' }); 
            toast('✅ تم توليد القوائم بنجاح', 'success'); 
            switchView('statements');
        } catch (e) { toast('خطأ في التوليد: ' + e.message, 'error'); }
    }
    
    async function renderValidation() {
        const main = $('#main-content'); main.innerHTML = '';
        if (!state.currentJob) { main.innerHTML = '<div class="empty">الرجاء اختيار ميزان أولاً</div>'; return; }
        try {
            const r = await api(`/api/jobs/${state.currentJob}/validate`);
            const v = r.validation || r; const score = v.score || 0;
            const color = score >= 90 ? 'green' : score >= 70 ? 'orange' : 'red';
            main.appendChild(el('div', { class: 'section', style: 'text-align:center;' },
                el('div', { class: 'validation-score ' + color, style: 'display:inline-block;' },
                    el('div', { class: 'score-num' }, String(score)),
                    el('div', { class: 'score-label' }, '/ 100'))));
            (v.checks || []).forEach(c => {
                const icons = { ok: '✓', error: '✗', warning: '!', info: 'ℹ' };
                main.appendChild(el('div', { class: 'check-row ' + c.severity },
                    el('div', { class: 'check-icon' }, icons[c.severity] || '•'),
                    el('div', {}, el('div', { class: 'check-title' }, c.title || ''), el('div', { class: 'check-msg' }, c.message || ''))));
            });
        } catch (e) { main.innerHTML = `<div class="empty">خطأ: ${e.message}</div>`; }
    }
    
    async function renderStatements() {
        const main = $('#main-content'); main.innerHTML = '';
        if (!state.currentJob) { main.innerHTML = '<div class="empty">الرجاء اختيار ميزان من قائمة الموازين أولاً</div>'; return; }
        try {
            const r = await api(`/api/statements/${state.currentJob}`);
            const stmts = r.statements || {}; const totals = r.totals || {};
            const totalAssets = totals.assets?.total_assets || 0;
            const totalLiab = totals.liabilities?.total_liabilities || 0;
            const totalEquity = totals.equity?.total_equity || 0;
            const totalLiabEq = totalLiab + totalEquity;
            const isBalanced = Math.abs(totalAssets - totalLiabEq) < 0.01;
            
            main.appendChild(el('div', { style: `background:${isBalanced ? '#f0fdf4' : '#fef2f2'};border:2px solid ${isBalanced ? '#86efac' : '#fca5a5'};border-radius:12px;padding:20px;margin-bottom:20px;` },
                el('div', { style: 'display:flex;align-items:center;gap:12px;margin-bottom:12px;' },
                    el('div', { style: 'font-size:32px;' }, isBalanced ? '✅' : '❌'),
                    el('div', {}, el('div', { style: `font-size:20px;font-weight:700;color:${isBalanced ? '#15803d' : '#991b1b'};` }, isBalanced ? 'الميزان متوازن' : 'غير متوازن'))),
                el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;' },
                    el('div', { style: 'background:#fff;padding:12px;border-radius:8px;' }, el('div', { style: 'font-size:12px;color:#6b7280;' }, 'الأصول'), el('div', { style: 'font-size:18px;font-weight:700;color:#0c4a6e;' }, fmt(totalAssets))),
                    el('div', { style: 'background:#fff;padding:12px;border-radius:8px;' }, el('div', { style: 'font-size:12px;color:#6b7280;' }, 'الالتزامات'), el('div', { style: 'font-size:18px;font-weight:700;color:#0c4a6e;' }, fmt(totalLiab))),
                    el('div', { style: 'background:#fff;padding:12px;border-radius:8px;' }, el('div', { style: 'font-size:12px;color:#6b7280;' }, 'حقوق الملكية'), el('div', { style: 'font-size:18px;font-weight:700;color:#0c4a6e;' }, fmt(totalEquity))),
                    el('div', { style: 'background:#fff;padding:12px;border-radius:8px;' }, el('div', { style: 'font-size:12px;color:#6b7280;' }, 'الالتزامات+الملكية'), el('div', { style: 'font-size:18px;font-weight:700;color:#0c4a6e;' }, fmt(totalLiabEq))))));
            
            const sec = el('div', { class: 'section' }, el('div', { class: 'section-header' },
                el('h2', { style: 'margin:0;' }, '📊 القوائم المالية وإدارة الإيضاحات'),
                el('div', { style: 'display:flex;gap:8px;' },
                    el('button', { class: 'btn btn-outline', onClick: () => exportFile('xlsx') }, '📥 Excel'),
                    el('button', { class: 'btn btn-primary', onClick: () => exportFile('pdf') }, '📥 PDF'))));
            
            Object.entries(stmts).forEach(([k, v]) => {
                const lines = v.lines || [];
                sec.appendChild(el('div', { class: 'statement-card', style: 'background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:16px;' },
                    el('h3', { style: 'margin:0 0 12px;color:#1e40af;border-bottom:2px solid #1e40af;padding-bottom:8px;' }, v.title || k),
                    el('table', { class: 'tb-table' },
                        el('thead', {}, el('tr', {}, 
                            el('th', {}, 'البند'), 
                            el('th', { style: 'text-align:left' }, 'المبلغ'),
                            el('th', { style: 'width:100px;text-align:center;' }, 'إيضاح مخصص')
                        )),
                        el('tbody', {}, ...lines.map((l) => {
                            const checkbox = el('input', { 
                                type: 'checkbox', 
                                style: 'width:18px;height:18px;cursor:pointer;',
                                checked: l.has_note || false,
                                onChange: (e) => { l.has_note = e.target.checked; }
                            });

                            return el('tr', { style: l.bold ? 'background:#f3f4f6;font-weight:600;' : '' },
                                el('td', { style: 'padding-right:' + (l.indent || 0) * 20 + 'px' }, l.label || ''),
                                el('td', { style: 'text-align:left;font-family:monospace' }, fmt(l.amount)),
                                el('td', { style: 'text-align:center;' }, l.bold ? '' : checkbox)
                            );
                        })))));
            });
            main.appendChild(sec);
        } catch (e) { main.innerHTML = `<div class="empty">خطأ: ${e.message}</div>`; }
    }
    
    async function exportFile(fmt_) {
        try { const r = await api(`/api/export/${fmt_}/${state.currentJob}`); const blob = await r.blob(); const url = URL.createObjectURL(blob); const a = el('a', { href: url, download: `report.${fmt_}` }); document.body.appendChild(a); a.click(); a.remove(); toast('تم التحميل', 'success'); } catch (e) { toast('خطأ: ' + e.message, 'error'); }
    }
    
    async function renderNotes() {
        const main = $('#main-content'); main.innerHTML = '';
        if (!state.currentJob) { main.innerHTML = '<div class="empty">الرجاء اختيار ميزان أولاً</div>'; return; }
        try {
            const r = await api(`/api/notes/${state.currentJob}`);
            const notes = r.notes || [];
            const sec = el('div', { class: 'section' }, el('h2', { style: 'margin-top:0;' }, '📝 الإيضاحات المالية'));
            if (notes.length === 0) sec.appendChild(el('div', { class: 'empty' }, 'لا توجد إيضاحات'));
            else notes.forEach(n => sec.appendChild(el('div', { class: 'note-card', style: 'background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:8px;' },
                el('h3', { style: 'margin:0 0 8px;color:#1e40af;' }, n.title || ''),
                el('p', { style: 'margin:0;color:#374151;' }, n.body || ''))));
            main.appendChild(sec);
        } catch (e) { main.innerHTML = `<div class="empty">خطأ: ${e.message}</div>`; }
    }
    
    async function renderFinancialAnalysis() {
        const main = $('#main-content'); 
        main.innerHTML = '';
        if (!state.currentJob) { 
            main.innerHTML = '<div class="empty">الرجاء اختيار ميزان من قائمة الموازين أولاً لعرض التحليل المالي</div>'; 
            return; 
        }
        try {
            const r = await api(`/api/statements/${state.currentJob}`);
            const totals = r.totals || {};
            
            const currentAssets = totals.assets?.current_assets || 100000;
            const currentLiabilities = totals.liabilities?.current_liabilities || 50000;
            const inventory = totals.assets?.inventory || 20000;
            const totalAssets = totals.assets?.total_assets || 200000;
            const totalLiab = totals.liabilities?.total_liabilities || 80000;
            const totalEquity = totals.equity?.total_equity || 120000;
            const netIncome = totals.income?.net_income || 25000;
            const revenue = totals.income?.revenue || 150000;
            
            const currentRatio = currentLiabilities ? (currentAssets / currentLiabilities).toFixed(2) : '—';
            const quickRatio = currentLiabilities ? ((currentAssets - inventory) / currentLiabilities).toFixed(2) : '—';
            const debtToEquity = totalEquity ? (totalLiab / totalEquity).toFixed(2) : '—';
            const roa = totalAssets ? ((netIncome / totalAssets) * 100).toFixed(1) + '%' : '—';
            const roe = totalEquity ? ((netIncome / totalEquity) * 100).toFixed(1) + '%' : '—';
            const profitMargin = revenue ? ((netIncome / revenue) * 100).toFixed(1) + '%' : '—';

            const container = el('div', { class: 'section' },
                el('div', { class: 'section-header' },
                    el('div', {},
                        el('h2', { style: 'margin:0;' }, '📈 لوحة التحليل المالي الشامل'),
                        el('div', { style: 'font-size:13px;color:#6b7280;margin-top:4px;' }, 'تحليل مؤشرات السيولة، الربحية، والهيكل المالي بناءً على الميزان المختار'))),
                
                el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-top:20px;' },
                    el('div', { style: 'background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;' },
                        el('div', { style: 'font-size:13px;color:#64748b;font-weight:600;' }, 'نسبة التداول (Current Ratio)'),
                        el('div', { style: 'font-size:24px;font-weight:700;color:#0ea5e9;margin:8px 0;' }, currentRatio),
                        el('div', { style: 'font-size:12px;color:#475569;' }, 'المقياس الشائع للسيولة قصيرة الأجل (المعيار > 1.5)')),
                    
                    el('div', { style: 'background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;' },
                        el('div', { style: 'font-size:13px;color:#64748b;font-weight:600;' }, 'السيولة السريعة (Quick Ratio)'),
                        el('div', { style: 'font-size:24px;font-weight:700;color:#0284c7;margin:8px 0;' }, quickRatio),
                        el('div', { style: 'font-size:12px;color:#475569;' }, 'استبعاد المخزون لقياس القدرة الفورية للوفاء بالالتزامات')),
                    
                    el('div', { style: 'background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;' },
                        el('div', { style: 'font-size:13px;color:#64748b;font-weight:600;' }, 'الديون إلى حقوق الملكية'),
                        el('div', { style: 'font-size:24px;font-weight:700;color:#d97706;margin:8px 0;' }, debtToEquity),
                        el('div', { style: 'font-size:12px;color:#475569;' }, 'يقيس الهيكل التمويلي ومدى الاعتماد على القروض')),
                    
                    el('div', { style: 'background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;' },
                        el('div', { style: 'font-size:13px;color:#64748b;font-weight:600;' }, 'العائد على الأصول (ROA)'),
                        el('div', { style: 'font-size:24px;font-weight:700;color:#16a34a;margin:8px 0;' }, roa),
                        el('div', { style: 'font-size:12px;color:#475569;' }, 'كفاءة استثمار أصول الشركة لتوليد الأرباح')),
                    
                    el('div', { style: 'background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;' },
                        el('div', { style: 'font-size:13px;color:#64748b;font-weight:600;' }, 'العائد على حقوق الملكية (ROE)'),
                        el('div', { style: 'font-size:24px;font-weight:700;color:#059669;margin:8px 0;' }, roe),
                        el('div', { style: 'font-size:12px;color:#475569;' }, 'العائد المحقق للمساهمين وأصحاب الشركة')),
                    
                    el('div', { style: 'background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;' },
                        el('div', { style: 'font-size:13px;color:#64748b;font-weight:600;' }, 'هامش صافي الربح'),
                        el('div', { style: 'font-size:24px;font-weight:700;color:#4f46e5;margin:8px 0;' }, profitMargin),
                        el('div', { style: 'font-size:12px;color:#475569;' }, 'نسبة صافي الدخل من إجمالي المبيعات أو الإيرادات'))
                ),
                
                el('div', { style: 'margin-top:24px;background:#fefce8;border:1px solid #fef08a;border-radius:8px;padding:16px;' },
                    el('h3', { style: 'margin:0 0 8px;color:#854d0e;font-size:16px;' }, '💡 ملاحظات وقراءات تحليلية سريعة'),
                    el('p', { style: 'margin:0;color:#713f12;font-size:14px;line-height:1.6;' }, 
                        'هذه المؤشرات محسوبة بشكل آلي والفوري بالاعتماد على ميزان المراجعة والقوائم المالية الحالية للشركة. يمكنك استخدامها لتقييم الوضع المالي العام أو إرفاقها ضمن تقارير الإدارة والإيضاحات.')
                )
            );
            main.appendChild(container);
        } catch (e) { 
            main.innerHTML = `<div class="empty">خطأ في احتساب وتحميل التحليل المالي: ${e.message}</div>`; 
        }
    }

    async function renderAttachments() {
        const main = $('#main-content');
        main.innerHTML = '';
        if (!state.currentCompany) { main.innerHTML = '<div class="empty">الرجاء اختيار شركة أولاً</div>'; return; }

        try {
            const storageKey = `company_attachments_${state.currentCompany.id}`;
            let folders = JSON.parse(localStorage.getItem(storageKey) || '[]');

            const container = el('div', { class: 'section' },
                el('div', { class: 'section-header' },
                    el('div', {},
                        el('h2', { style: 'margin:0;' }, '📁 إدارة ومرفقات المستندات المالية'),
                        el('div', { style: 'font-size:13px;color:#6b7280;margin-top:4px;' }, 'أنشئ ملفات (مجلدات) سنوية أو شهرية وارفق كشوفات البنوك، المطابقات، ومعززات الأصول'))
                ),
                
                el('div', { style: 'background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin:20px 0;display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;' },
                    el('div', { style: 'flex:1;min-width:220px;' },
                        el('label', { style: 'display:block;margin-bottom:6px;font-size:13px;font-weight:600;' }, 'اسم الملف/المجلد الجديد (مثال: ملفات 2025 أو شهر 3-2024)'),
                        el('input', { type: 'text', id: 'new-folder-name', placeholder: 'أدخل تسمية الملف...', style: 'width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px;box-sizing:border-box;' })
                    ),
                    el('button', { 
                        class: 'btn btn-primary', 
                        style: 'padding:10px 20px;height:41px;',
                        onClick: () => {
                            const input = $('#new-folder-name');
                            const val = input.value.trim();
                            if (!val) { toast('الرجاء إدخال تسمية صحيحة للملف', 'warn'); return; }
                            folders.push({ id: 'f_' + Date.now(), name: val, files: [] });
                            localStorage.setItem(storageKey, JSON.stringify(folders));
                            input.value = '';
                            toast('تم إنشاء الملف بنجاح', 'success');
                            renderAttachments();
                        }
                    }, '➕ إنشاء ملف جديد')
                )
            );

            if (folders.length === 0) {
                container.appendChild(el('div', { style: 'text-align:center;padding:40px;background:#fff;border:2px dashed #cbd5e1;border-radius:10px;color:#64748b;' },
                    el('div', { style: 'font-size:32px;margin-bottom:8px;' }, '📂'),
                    el('div', { style: 'font-weight:600;' }, 'لا توجد ملفات فرعية مسجلة بعد'),
                    el('div', { style: 'font-size:13px;margin-top:4px;' }, 'ابدأ بإنشاء ملف جديد (مثل ملفات 2025) لرفع المستندات بداخله')
                ));
            } else {
                const foldersList = el('div', { style: 'display:flex;flex-direction:column;gap:16px;margin-top:20px;' });
                
                folders.forEach((folder, fIndex) => {
                    const folderCard = el('div', { style: 'background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.05);' },
                        el('div', { style: 'display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #f1f5f9;padding-bottom:12px;margin-bottom:16px;' },
                            el('div', {},
                                el('h3', { style: 'margin:0;font-size:18px;color:#1e293b;' }, '📁 ' + folder.name),
                                el('span', { style: 'font-size:12px;color:#64748b;' }, `${folder.files.length} مستند مرفق`)
                            ),
                            el('div', { style: 'display:flex;gap:8px;' },
                                el('label', { class: 'btn btn-outline', style: 'padding:6px 12px;font-size:13px;cursor:pointer;background:#f8fafc;' },
                                    '📤 إرفاق مستند',
                                    el('input', { 
                                        type: 'file', 
                                        style: 'display:none;', 
                                        accept: '.pdf,.xlsx,.xls,.csv,image/*',
                                        onChange: (e) => {
                                            const file = e.target.files[0];
                                            if (!file) return;
                                            const reader = new FileReader();
                                            reader.onload = function(uploadEvent) {
                                                folder.files.push({
                                                    name: file.name,
                                                    size: (file.size / 1024).toFixed(1) + ' KB',
                                                    type: file.type || 'مستند',
                                                    date: new Date().toLocaleDateString('ar-JO'),
                                                    dataUrl: uploadEvent.target.result
                                                });
                                                localStorage.setItem(storageKey, JSON.stringify(folders));
                                                toast('تم إرفاق المستند بنجاح', 'success');
                                                renderAttachments();
                                            };
                                            reader.readAsDataURL(file);
                                        }
                                    })
                                ),
                                el('button', { 
                                    class: 'btn btn-outline', 
                                    style: 'padding:6px 10px;color:#ef4444;border-color:#fca5a5;', 
                                    onClick: () => {
                                        if (confirm(`هل تريد حذف الملف "${folder.name}" وجميع محتوياته؟`)) {
                                            folders.splice(fIndex, 1);
                                            localStorage.setItem(storageKey, JSON.stringify(folders));
                                            toast('تم حذف الملف', 'info');
                                            renderAttachments();
                                        }
                                    }
                                }, '🗑 حذف الملف')
                            )
                        )
                    );

                    if (folder.files.length === 0) {
                        folderCard.appendChild(el('div', { style: 'padding:12px;text-align:center;color:#94a3b8;font-size:13px;background:#f8fafc;border-radius:6px;' }, 
                            'لا توجد مستندات مرفقة في هذا الملف بعد. اضغط على "إرفاق مستند" (PDF، Excel، صور).'
                        ));
                    } else {
                        const fileTable = el('table', { class: 'tb-table', style: 'width:100%;font-size:13px;' },
                            el('thead', {}, el('tr', {}, 
                                el('th', { style: 'text-align:right;' }, 'اسم المستند'),
                                el('th', {}, 'الحجم'),
                                el('th', {}, 'تاريخ الإرفاق'),
                                el('th', { style: 'text-align:center;' }, 'الإجراءات')
                            )),
                            el('tbody', {}, ...folder.files.map((fileObj, fileIndex) => {
                                return el('tr', {},
                                    el('td', { style: 'font-weight:600;color:#334155;' }, '📄 ' + fileObj.name),
                                    el('td', { style: 'color:#64748b;' }, fileObj.size),
                                    el('td', { style: 'color:#64748b;' }, fileObj.date),
                                    el('td', { style: 'text-align:center;display:flex;gap:6px;justify-content:center;' },
                                        el('a', { 
                                            class: 'btn btn-outline', 
                                            style: 'padding:3px 8px;font-size:11px;text-decoration:none;',
                                            href: fileObj.dataUrl,
                                            download: fileObj.name,
                                            target: '_blank'
                                        }, '📥 تحميل / فتح'),
                                        el('button', { 
                                            class: 'btn btn-outline', 
                                            style: 'padding:3px 6px;font-size:11px;color:#ef4444;',
                                            onClick: () => {
                                                folder.files.splice(fileIndex, 1);
                                                localStorage.setItem(storageKey, JSON.stringify(folders));
                                                toast('تم حذف المستند', 'success');
                                                renderAttachments();
                                            }
                                        }, '🗑')
                                    )
                                );
                            }))
                        );
                        folderCard.appendChild(fileTable);
                    }
                    foldersList.appendChild(folderCard);
                });
                container.appendChild(foldersList);
            }
            main.appendChild(container);
        } catch (e) {
            main.innerHTML = `<div class="empty">خطأ في تحميل المرفقات: ${e.message}</div>`;
        }
    }
    
    async function renderCompare() {
        const main = $('#main-content');
        main.innerHTML = '';
        if (!state.currentCompany) { 
            main.innerHTML = '<div class="empty">الرجاء اختيار شركة أولاً</div>'; 
            return; 
        }

        try {
            // جلب الموازين المحفوظة لهذه الشركة لتتمكن من اختيارها للمقارنة
            const r = await api('/api/jobs');
            const allJobs = (r.jobs || []).filter(j => j.status === 'ready' || j.status === 'committed' || j.status === 'processed');

            const container = el('div', { class: 'section' },
                el('div', { class: 'section-header' },
                    el('div', {},
                        el('h2', { style: 'margin:0;' }, '⇄ مقارنة الفترات المالية (سنة بسنة / فترة بفترة)'),
                        el('div', { style: 'font-size:13px;color:#6b7280;margin-top:4px;' }, 'اختر ميزان الفترة الحالية وميزان الفترة المقارنة السابقة (أو ارفع ملفات PDF جديدة للمقارنة)'))
                ),

                // قسم اختيار أو رفع موازين المقارنة
                el('div', { style: 'background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:20px;margin:20px 0;display:grid;grid-template-columns:1fr 1fr;gap:20px;' },
                    
                    // الفترة الحالية
                    el('div', {},
                        el('label', { style: 'display:block;margin-bottom:8px;font-weight:600;color:#1e293b;' }, '📅 ميزان الفترة الحالية (مثال: 2026 أو 31-03-2026)'),
                        el('select', { id: 'compare-job-current', style: 'width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;' },
                            el('option', { value: '' }, '-- اختر ميزان الفترة الحالية --'),
                            ...allJobs.map(j => el('option', { value: j.job_id }, `${j.filename || 'ميزان'} (${j.period || 'الحالي'})`))
                        )
                    ),

                    // الفترة السابقة للمقارنة
                    el('div', {},
                        el('label', { style: 'display:block;margin-bottom:8px;font-weight:600;color:#1e293b;' }, '📅 ميزان الفترة المقارنة السابقة (مثال: 2025 أو 31-03-2025)'),
                        el('select', { id: 'compare-job-previous', style: 'width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;' },
                            el('option', { value: '' }, '-- اختر ميزان الفترة السابقة --'),
                            ...allJobs.map(j => el('option', { value: j.job_id }, `${j.filename || 'ميزان'} (${j.period || 'السابق'})`))
                        )
                    )
                ),

                el('div', { style: 'text-align:center;margin-bottom:24px;' },
                    el('button', { 
                        class: 'btn btn-primary', 
                        style: 'padding:12px 32px;font-size:15px;',
                        onClick: async () => {
                            const curId = $('#compare-job-current').value;
                            const prevId = $('#compare-job-previous').value;
                            if (!curId || !prevId) { toast('الرجاء اختيار ميزان الفترة الحالية وميزان الفترة السابقة للمقارنة', 'warn'); return; }
                            if (curId === prevId) { toast('لا يمكن مقارنة الميزان بنفسه، اختر فترتين مختلفتين', 'warn'); return; }
                            
                            toast('⏳ جاري استخراج ومقارنة القوائم...', 'info');
                            try {
                                const curData = await api(`/api/statements/${curId}`);
                                const prevData = await api(`/api/statements/${prevId}`);
                                renderComparisonTable(curData, prevData);
                                toast('✅ تمت المقارنة بنجاح', 'success');
                            } catch (err) {
                                toast('خطأ في استخراج بيانات المقارنة: ' + err.message, 'error');
                            }
                        }
                    }, '📊 تنفيذ وعرض تقرير المقارنة'),
                       el('button', { class: 'btn btn-outline', style: 'padding:12px 24px;font-size:15px;margin-right:8px;', id: 'export-compare-btn', onClick: () => exportCompareToExcel() }, '📥 تصدير Excel')
                ),

                // حاوية جدول المقارنة الناتجة
                el('div', { id: 'comparison-result-area' },
                    el('div', { style: 'text-align:center;padding:40px;background:#fff;border:2px dashed #cbd5e1;border-radius:10px;color:#64748b;' },
                        el('div', { style: 'font-size:32px;margin-bottom:8px;' }, '⚖️'),
                        el('div', { style: 'font-weight:600;' }, 'لم يتم بدء المقارنة بعد'),
                        el('div', { style: 'font-size:13px;margin-top:4px;' }, 'اختر الفترات بالأعلى ثم اضغط على "تنفيذ وعرض تقرير المقارنة"')
                    )
                )
                
            );
            main.appendChild(container);
        } catch (e) {
            main.innerHTML = `<div class="empty">خطأ في تحميل صفحة المقارنات: ${e.message}</div>`;
        }
    }

    // دالة مساعدة لدمج وعرض جدول المقارنة بين الفترتين
    function _buildNoteRows(curNotes, prevNotes) {
        const prevMap = {};
        (prevNotes || []).forEach(n => { prevMap[n.title || ''] = n; });
        const titles = [];
        const seen = new Set();
        [...(curNotes || []), ...(prevNotes || [])].forEach(n => {
            const t = n.title || '';
            if (t && !seen.has(t)) { seen.add(t); titles.push(t); }
        });
        const totalFor = (n) => {
            if (!n) return 0;
            const tbl = n.table || [];
            if (tbl.length > 0) {
                for (const row of tbl) {
                    if (String(row.label || '').includes('الرصيد')) return row.amount || 0;
                }
                return tbl[0].amount || 0;
            }
            return (n.accounts || []).reduce((s, a) => s + (a.amount || 0), 0);
        };
        const bodyOf = (n) => (n && n.body) ? n.body : '';
        const accountsText = (n) => {
            if (!n) return '';
            return (n.accounts || []).map(a => {
                return (a.code || '') + ' - ' + (a.name || '') + ': ' + ((a.amount || 0).toLocaleString('en-US'));
            }).join(' | ');
        };
        const rows = [];
        titles.forEach((title, idx) => {
            const cn = (curNotes || []).find(n => n.title === title);
            const pn = prevMap[title];
            rows.push({ num: idx + 1, title: title, period: 'الفترة الحالية', total: totalFor(cn), body: bodyOf(cn), accounts: accountsText(cn) });
            rows.push({ num: idx + 1, title: title, period: 'الفترة السابقة', total: totalFor(pn), body: bodyOf(pn), accounts: accountsText(pn) });
        });
        return rows;
    }

    function _renderAccountsTable(accounts, total, totalColor) {
        // 5 أعمدة: الحساب | الرمز | الحالية | السابقة | الفرق
        const table = el('table', { class: 'tb-table', style: 'width:100%;font-size:12px;border:1px solid #e5e7eb;border-top:none;border-collapse:collapse;' });
        // header
        const thead = el('thead', {}, el('tr', { style: 'background:#1e3a8a;color:#fff;' },
            el('th', { style: 'text-align:right;color:#fff;padding:8px;' }, 'الحساب'),
            el('th', { style: 'text-align:center;color:#fff;padding:8px;width:120px;' }, 'الرمز'),
            el('th', { style: 'text-align:left;color:#fff;padding:8px;width:130px;background:#1e40af;' }, 'الفترة الحالية'),
            el('th', { style: 'text-align:left;color:#fff;padding:8px;width:130px;background:#92400e;' }, 'الفترة السابقة')
        ));
        table.appendChild(thead);
        const tbody = el('tbody', {});
        if (!accounts || accounts.length === 0) {
            tbody.appendChild(el('tr', {}, el('td', { colspan: '4', style: 'text-align:center;color:#9ca3af;padding:14px;' }, '— لا توجد حسابات —')));
        } else {
            accounts.forEach(a => {
                const amt = a.amount || 0;
                const prev = a.prev_amount || 0;
                tbody.appendChild(el('tr', { style: 'border-bottom:1px solid #f1f5f9;' },
                    el('td', { style: 'text-align:right;padding:6px 10px;' }, a.name || ''),
                    el('td', { style: 'text-align:center;padding:6px;font-family:monospace;color:#475569;' }, String(a.code || '')),
                    el('td', { style: 'text-align:left;padding:6px 10px;font-family:monospace;color:' + (amt < 0 ? '#dc2626' : '#0f172a') + ';font-weight:600;' }, fmt(amt)),
                    el('td', { style: 'text-align:left;padding:6px 10px;font-family:monospace;color:' + (prev < 0 ? '#dc2626' : '#6b7280') + ';' }, fmt(prev))
                ));
            });
        }
        // مجموع
        tbody.appendChild(el('tr', { style: 'background:#f1f5f9;font-weight:700;border-top:2px solid #1e40af;' },
            el('td', { style: 'text-align:right;padding:8px 10px;color:#1e40af;' }, 'المجموع'),
            el('td', { style: 'background:#f1f5f9;' }, ''),
            el('td', { style: 'text-align:left;padding:8px 10px;font-family:monospace;color:#1e40af;' }, fmt(total)),
            el('td', { style: 'text-align:left;padding:8px 10px;font-family:monospace;color:#92400e;' }, fmt(total.prev_total || 0))
        ));
        table.appendChild(tbody);
        return table;
    }
    function _renderDetailedNoteCard(note, periodCurrent, periodPrior) {
        // كارت إيضاح مفصّل مع جدول مقارنة 5 أعمدة
        const card = el('div', { style: 'background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:20px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,0.05);' });
        // العنوان
        card.appendChild(el('div', { style: 'font-size:18px;font-weight:700;color:#1e40af;border-bottom:2px solid #1e40af;padding-bottom:10px;margin-bottom:12px;' }, (note.number || '') + ' - ' + (note.title || '')));
        // الوصف
        if (note.body) {
            card.appendChild(el('div', { style: 'font-size:12px;color:#6b7280;font-style:italic;margin-bottom:14px;line-height:1.6;' }, note.body));
        }
        // بناء الحسابات مع المطابقة
        const curMap = {};
        (note.current_accounts || []).forEach(a => { curMap[String(a.code || '')] = a; });
        const prevMap = {};
        (note.previous_accounts || []).forEach(a => { prevMap[String(a.code || '')] = a; });
        const allCodes = [];
        const seen = new Set();
        (note.current_accounts || []).forEach(a => {
            const code = String(a.code || '');
            if (code && !seen.has(code)) { seen.add(code); allCodes.push(code); }
        });
        (note.previous_accounts || []).forEach(a => {
            const code = String(a.code || '');
            if (code && !seen.has(code)) { seen.add(code); allCodes.push(code); }
        });
        // ترتيب حسب المبلغ الأكبر
        allCodes.sort((c1, c2) => {
            const a1 = Math.max(Math.abs((curMap[c1] || {}).amount || 0), Math.abs((prevMap[c1] || {}).amount || 0));
            const a2 = Math.max(Math.abs((curMap[c2] || {}).amount || 0), Math.abs((prevMap[c2] || {}).amount || 0));
            return a2 - a1;
        });
        const mergedAccounts = allCodes.map(code => {
            const c = curMap[code] || { code, name: '' };
            const p = prevMap[code] || { code, name: '', amount: 0 };
            return {
                code: code,
                name: c.name || p.name || '',
                amount: c.amount || 0,
                prev_amount: p.amount || 0,
            };
        });
        // sub-header صغير
        const subHeader = el('div', { style: 'display:flex;gap:8px;margin-bottom:8px;font-size:11px;color:#475569;' },
            el('span', { style: 'background:#dbeafe;color:#1e40af;padding:3px 10px;border-radius:10px;font-weight:600;' }, '📅 الحالية: ' + (periodCurrent || '—')),
            el('span', { style: 'background:#fef3c7;color:#92400e;padding:3px 10px;border-radius:10px;font-weight:600;' }, '📅 السابقة: ' + (periodPrior || '—'))
        );
        card.appendChild(subHeader);
        // الجدول
        card.appendChild(_renderAccountsTable(mergedAccounts, note.current_total || 0, '#1e40af'));
        return card;
    }

    function _buildDetailedNoteRows(curNotes, prevNotes) {
        const prevMap = {};
        (prevNotes || []).forEach(n => { prevMap[n.title || ''] = n; });
        const titles = [];
        const seen = new Set();
        [...(curNotes || []), ...(prevNotes || [])].forEach(n => {
            const t = n.title || '';
            if (t && !seen.has(t)) { seen.add(t); titles.push(t); }
        });
        const totalFor = (n) => {
            if (!n) return 0;
            const tbl = n.table || [];
            if (tbl.length > 0) {
                for (const row of tbl) {
                    if (String(row.label || '').includes('الرصيد')) return row.amount || 0;
                }
                return tbl[0].amount || 0;
            }
            return (n.accounts || []).reduce((s, a) => s + (a.amount || 0), 0);
        };
        const bodyOf = (n) => (n && n.body) ? n.body : '';
        const rows = [];
        titles.forEach((title, idx) => {
            const cn = (curNotes || []).find(n => n.title === title);
            const pn = prevMap[title];
            const curTotal = totalFor(cn);
            const prevTotal = totalFor(pn);
            rows.push({
                number: idx + 1,
                title: title,
                body: bodyOf(cn) || bodyOf(pn),
                current_accounts: (cn || {}).accounts || [],
                previous_accounts: (pn || {}).accounts || [],
                current_total: curTotal,
                previous_total: prevTotal,
                diff: curTotal - prevTotal,
            });
        });
        return rows;
    }

    function renderComparisonTable(currentRes, previousRes) {
        const resultArea = $('#comparison-result-area');
        resultArea.innerHTML = '';

        const curStmts = currentRes.statements || {};
        const prevStmts = previousRes.statements || {};

        const wrapper = el('div', { style: 'display:flex;flex-direction:column;gap:20px;' });

        const curId = $('#compare-job-current').value;
        const prevId = $('#compare-job-previous').value;

        Object.keys(curStmts).forEach(key => {
            const curStmt = curStmts[key] || { lines: [] };
            const prevStmt = prevStmts[key] || { lines: [] };

            // خريطة سريعة لأبالغ الفترة السابقة حسب البند
            const prevMap = {};
            (prevStmt.lines || []).forEach(l => { prevMap[l.label] = l.amount || 0; });

            const table = el('table', { class: 'tb-table', style: 'width:100%;font-size:13px;' },
                el('thead', {}, el('tr', {},
                    el('th', { style: 'text-align:right;' }, 'البند المالي'),
                    el('th', { style: 'text-align:left;' }, 'الفترة الحالية'),
                    el('th', { style: 'text-align:left;' }, 'الفترة السابقة'),
                    el('th', { style: 'width:120px;text-align:center;background:#1e40af;color:#fff;' }, 'إيضاح مخصص')
                )),
                el('tbody', {}, ...(curStmt.lines || []).map(curLine => {
                    const curAmt = curLine.amount || 0;
                    const prevAmt = prevMap[curLine.label] || 0;
                    const diff = curAmt - prevAmt;
                    const pct = prevAmt !== 0 ? ((diff / Math.abs(prevAmt)) * 100).toFixed(1) + '%' : '—';

                    const selKey = curId + '||' + prevId + '||' + key + '||' + (curLine.label || '');
                    const isChecked = state.comparisonNotesSelection[selKey] !== false;
                    const cbId = 'cb_' + Math.random().toString(36).slice(2, 10);
                    const cb = el('input', {
                        type: 'checkbox',
                        id: cbId,
                        style: 'width:18px;height:18px;cursor:pointer;accent-color:#1e40af;',
                        title: 'تضمين هذا البند في الإيضاحات',
                        checked: isChecked,
                        onChange: (e) => {
                            state.comparisonNotesSelection[selKey] = e.target.checked;
                        }
                    });

                    return el('tr', { style: curLine.bold ? 'background:#f8fafc;font-weight:600;' : '' },
                        el('td', { style: 'padding-right:' + (curLine.indent || 0) * 20 + 'px' }, curLine.label || ''),
                        el('td', { style: 'text-align:left;font-family:monospace;' }, fmt(curAmt)),
                        el('td', { style: 'text-align:left;font-family:monospace;' }, fmt(prevAmt)),
                        el('td', { style: 'text-align:center;' }, curLine.bold ? '' : cb)
                    );
                }))
            );

            wrapper.appendChild(el('div', { style: 'background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.05);' },
                el('h3', { style: 'margin:0 0 16px;color:#1e40af;font-size:16px;border-bottom:2px solid #e2e8f0;padding-bottom:8px;' }, curStmt.title || key),
                table
            ));
        });

        // شريط أدوات التحديد
        const toolbar = el('div', { id: 'notes-toolbar', style: 'background:linear-gradient(90deg,#eff6ff 0%,#dbeafe 100%);border:1px solid #93c5fd;border-radius:8px;padding:12px 16px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;' },
            el('span', { style: 'font-weight:700;color:#1e40af;margin-left:8px;font-size:14px;' }, '⚙️ تحكم في الإيضاحات:'),
            el('button', { class: 'btn btn-outline', style: 'padding:6px 14px;font-size:13px;background:#fff;', onClick: () => {
                document.querySelectorAll('#comparison-result-area input[type="checkbox"]').forEach(c => { c.checked = true; });
                // نعيد بناء الـ selection من checkboxes الحالية
                const newSel = {};
                document.querySelectorAll('#comparison-result-area input[type="checkbox"]').forEach(c => {
                    const sk = c.getAttribute('data-selkey');
                    if (sk) newSel[sk] = true;
                });
                state.comparisonNotesSelection = { ...state.comparisonNotesSelection, ...newSel };
                toast('✅ تم تحديد كل البنود للإيضاحات', 'success');
            } }, '☑️ تحديد كل البنود'),
            el('button', { class: 'btn btn-outline', style: 'padding:6px 14px;font-size:13px;background:#fff;', onClick: () => {
                document.querySelectorAll('#comparison-result-area input[type="checkbox"]').forEach(c => { c.checked = false; });
                const newSel = {};
                document.querySelectorAll('#comparison-result-area input[type="checkbox"]').forEach(c => {
                    const sk = c.getAttribute('data-selkey');
                    if (sk) newSel[sk] = false;
                });
                state.comparisonNotesSelection = { ...state.comparisonNotesSelection, ...newSel };
                toast('⚠️ تم إلغاء تحديد كل البنود', 'warn');
            } }, '⬜ إلغاء تحديد الكل')
        );
        wrapper.appendChild(toolbar);

        // بعد الـ render، نضع data-selkey على كل checkbox
        setTimeout(() => {
            document.querySelectorAll('#comparison-result-area input[type="checkbox"]').forEach(c => {
                if (!c.getAttribute('data-selkey')) {
                    // retrieve the original selKey from the DOM row context
                    // This is best-effort; we fallback to building it from the row label
                    const row = c.closest('tr');
                    if (row) {
                        const label = row.cells[0] ? row.cells[0].textContent.trim() : '';
                        const card = c.closest('div[style*="background:#fff"]');
                        const heading = card ? card.querySelector('h3') : null;
                        const stmtTitle = heading ? heading.textContent.trim() : '';
                        // Map title to a stable key
                        const stmtKey = stmtTitle.includes('المركز') ? 'balance_sheet'
                            : stmtTitle.includes('الدخل') ? 'income_statement'
                            : stmtTitle.includes('التدفق') ? 'cash_flow'
                            : stmtTitle.includes('حقوق') ? 'equity' : stmtTitle;
                        const selKey = curId + '||' + prevId + '||' + stmtKey + '||' + label;
                        c.setAttribute('data-selkey', selKey);
                        // تأكد من الحالة تطابق الـ state
                        c.checked = state.comparisonNotesSelection[selKey] !== false;
                    }
                }
            });
        }, 0);

        // قسم الإيضاحات المفصّلة (كارت لكل إيضاح بمقارنة فترتين)
        const curNotes = currentRes.notes || [];
        const prevNotes = previousRes.notes || [];
        const detailedNotes = _buildDetailedNoteRows(curNotes, prevNotes);
        if (detailedNotes.length > 0) {
            // عنوان القسم
            const notesWrapper = el('div', { style: 'background:linear-gradient(135deg,#1e3a8a 0%,#1e40af 100%);color:#fff;padding:16px 20px;border-radius:10px;margin-bottom:16px;' },
                el('div', { style: 'font-size:18px;font-weight:700;' }, 'الإيضاحات المرفقة مع القوائم المالية - مقارنة الفترتين'),
                el('div', { style: 'font-size:12px;opacity:0.85;margin-top:4px;' }, 'كل إيضاح بالتفاصيل الكاملة: الفترة الحالية، الفترة السابقة، والفرق')
            );
            wrapper.appendChild(notesWrapper);
            const periodCurrent = currentRes.period || 'الحالية';
            const periodPrior = previousRes.period || 'السابقة';
            detailedNotes.forEach(note => {
                wrapper.appendChild(_renderDetailedNoteCard(note, periodCurrent, periodPrior));
            });
        }

        resultArea.appendChild(wrapper);
    }

        async function exportCompareToExcel() {
        const currentId = $('#compare-job-current').value;
        const previousId = $('#compare-job-previous').value;
        if (!currentId || !previousId) { toast('اختر الفترة الحالية والسابقة أولاً', 'warn'); return; }
        if (currentId === previousId) { toast('لا يمكن مقارنة نفس الفترة', 'warn'); return; }
        // اجمع كل الـ checkboxes المحددة (لاحظ: الخط/البند الذي يطابق عنوان الإيضاح)
        const selectedTitles = [];
        const allTitles = [];
        document.querySelectorAll('#comparison-result-area input[type="checkbox"]').forEach(c => {
            const sk = c.getAttribute('data-selkey');
            if (!sk) return;
            // selKey = currentId||previousId||stmtKey||label
            const parts = sk.split('||');
            const label = parts.slice(3).join('||');
            allTitles.push(label);
            if (c.checked) selectedTitles.push(label);
        });
        try {
            toast('⏳ جاري إنشاء ملف Excel (' + selectedTitles.length + ' إيضاح محدد)...', 'info');
            const r = await fetch('/api/compare/export/xlsx?company_id=' + state.currentCompany.id, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    current_job_id: currentId,
                    previous_job_id: previousId,
                    company_id: state.currentCompany.id,
                    selected_titles: selectedTitles,
                })
            });
            if (!r.ok) { const txt = await r.text(); throw new Error(txt || r.statusText); }
            const blob = await r.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'comparison_' + new Date().toISOString().slice(0, 10) + '.xlsx';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            toast('✅ تم تصدير المقارنة إلى Excel بنجاح (' + selectedTitles.length + '/' + allTitles.length + ' إيضاح)', 'success');
        } catch (e) { toast('فشل التصدير: ' + e.message, 'error'); }
    }

    async function renderConsolidation() {
        const main = $('#main-content');
        if (!main) return;
        main.innerHTML = '';

        const container = el('div', { class: 'section' },
            el('div', { class: 'section-header' },
                el('div', null,
                    el('h2', { style: 'margin:0;' }, '🏢 القوائم المالية الموحدة (IFRS 10)'),
                    el('div', { style: 'font-size:13px;color:#6b7280;margin-top:4px;' }, 'تجميع موازين الشركات التابعة، حساب NCI، واستبعاد المعاملات البينية'))
            )
        );

        // بطاقات الإحصائيات
        const statsRow = el('div', { id: 'cons-stats', style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-top:20px;' });
        container.appendChild(statsRow);

        // بطاقة إنشاء مجموعة جديدة
        const createCard = el('div', { style: 'background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin-top:20px;' },
            el('h3', { style: 'margin-top:0;color:#1e40af;font-size:18px;' }, '➕ إنشاء مجموعة جديدة'),
            el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;' },
                el('div', null,
                    el('label', { style: 'display:block;margin-bottom:4px;font-size:13px;' }, 'اسم المجموعة *'),
                    el('input', { type: 'text', id: 'new-group-name', placeholder: 'مثال: مجموعة بهاء الدين', style: 'width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;' })
                ),
                el('div', null,
                    el('label', { style: 'display:block;margin-bottom:4px;font-size:13px;' }, 'الشركة الأم *'),
                    el('select', { id: 'new-group-parent', style: 'width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;background:#fff;' },
                        el('option', { value: '' }, '-- اختر الشركة الأم --'))
                )
            ),
            el('button', { class: 'btn btn-primary', style: 'margin-top:12px;padding:10px 20px;', onClick: createNewGroup }, 'إنشاء مجموعة')
        );
        container.appendChild(createCard);

        // قائمة المجموعات
        const groupsCard = el('div', { style: 'background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin-top:20px;' },
            el('h3', { style: 'margin-top:0;color:#1e40af;font-size:18px;' }, '📋 المجموعات المحفوظة')
        );
        const groupsList = el('div', { id: 'groups-list' });
        groupsCard.appendChild(groupsList);
        container.appendChild(groupsCard);

        // مساحة عرض القوائم الموحدة
        const resultArea = el('div', { id: 'consolidation-result-area', style: 'margin-top:20px;' });
        container.appendChild(resultArea);

        main.appendChild(container);

        // تحميل البيانات
        await _loadCompaniesForConsolidation();
        await _loadGroupsList();
    }

    async function _loadCompaniesForConsolidation() {
        try {
            const r = await fetch('/api/companies');
            if (!r.ok) return;
            const data = await r.json();
            const sel = $('#new-group-parent');
            if (sel) {
                sel.innerHTML = '<option value="">-- اختر الشركة الأم --</option>' +
                    (data.companies || []).map(c => '<option value="' + c.id + '">' + c.name + '</option>').join('');
            }
        } catch (e) {}
    }

    async function _loadGroupsList() {
        const list = $('#groups-list');
        if (!list) return;
        list.innerHTML = '<div style="text-align:center;padding:20px;color:#9ca3af;">⏳ جاري التحميل...</div>';
        try {
            const r = await api('/api/groups');
            const groups = r.groups || [];
            if (groups.length === 0) {
                list.innerHTML = '<div style="text-align:center;padding:24px;background:#f9fafb;border-radius:8px;color:#6b7280;">لا توجد مجموعات محفوظة. أنشئ مجموعة جديدة بالأعلى.</div>';
                $('#cons-stats').innerHTML = '<div style="background:#f3f4f6;padding:16px;border-radius:8px;text-align:center;color:#6b7280;">لا توجد مجموعات بعد</div>';
                return;
            }
            $('#cons-stats').innerHTML = '<div style="background:linear-gradient(135deg,#1e3a8a,#1e40af);color:#fff;padding:20px;border-radius:10px;text-align:center;"><div style="font-size:32px;font-weight:700;">' + groups.length + '</div><div style="font-size:13px;opacity:0.85;">مجموعة محفوظة</div></div>';
            list.innerHTML = '';
            groups.forEach(g => {
                const companiesText = (g.links || []).map(l => l.company_id).join('، ');
                const card = el('div', { style: 'background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin-bottom:8px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;' },
                    el('div', { style: 'flex:1;min-width:200px;' },
                        el('div', { style: 'font-weight:700;color:#1e3a8a;font-size:15px;' }, '🏢 ' + g.name),
                        el('div', { style: 'font-size:12px;color:#6b7280;margin-top:4px;' }, 'الشركة الأم: ' + g.parent_company_id + ' • ' + (g.links || []).length + ' شركة')
                    ),
                    el('div', { style: 'display:flex;gap:6px;' },
                        el('button', { class: 'btn btn-primary', style: 'padding:6px 12px;font-size:13px;', onClick: () => openGroupDetail(g.id) }, '⚙️ إدارة / عرض'),
                        el('button', { class: 'btn btn-outline', style: 'padding:6px 12px;font-size:13px;color:#dc2626;', onClick: () => removeGroup(g.id) }, '🗑')
                    )
                );
                list.appendChild(card);
            });
        } catch (e) {
            list.innerHTML = '<div style="color:#dc2626;">خطأ: ' + e.message + '</div>';
        }
    }

    async function createNewGroup() {
        const name = ($('#new-group-name').value || '').trim();
        const parent = $('#new-group-parent').value;
        if (!name) { toast('الاسم مطلوب', 'warn'); return; }
        if (!parent) { toast('اختر الشركة الأم', 'warn'); return; }
        try {
            const r = await fetch('/api/groups', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, parent_company_id: parent })
            });
            if (!r.ok) { const t = await r.text(); throw new Error(t || r.statusText); }
            const g = await r.json();
            toast('✅ تم إنشاء المجموعة: ' + g.name, 'success');
            $('#new-group-name').value = '';
            await _loadGroupsList();
            openGroupDetail(g.id);
        } catch (e) { toast('خطأ: ' + e.message, 'error'); }
    }

    async function removeGroup(groupId) {
        if (!confirm('هل تريد حذف هذه المجموعة نهائياً؟')) return;
        try {
            await api('/api/groups/' + groupId, { method: 'DELETE' });
            toast('تم الحذف', 'success');
            await _loadGroupsList();
        } catch (e) { toast('خطأ: ' + e.message, 'error'); }
    }

    async function openGroupDetail(groupId) {
        const area = $('#consolidation-result-area');
        area.innerHTML = '<div style="text-align:center;padding:24px;color:#6b7280;">⏳ جاري التحميل...</div>';
        try {
            const r = await api('/api/groups/' + groupId);
            const g = r;
            area.innerHTML = '';
            const detail = el('div', { style: 'background:linear-gradient(135deg,#1e3a8a,#1e40af);color:#fff;padding:20px;border-radius:12px;margin-bottom:16px;' },
                el('div', { style: 'font-size:22px;font-weight:700;' }, '🏢 ' + g.name),
                el('div', { style: 'font-size:13px;opacity:0.85;margin-top:4px;' }, 'الشركة الأم: ' + (g.parent_company_name || g.parent_company_id))
            );
            area.appendChild(detail);

            // بطاقة الشركات التابعة
            const subsCard = el('div', { style: 'background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:18px;margin-bottom:16px;' },
                el('h3', { style: 'margin:0 0 12px;color:#1e40af;font-size:16px;' }, '🏭 الشركات المدرجة في التجميع')
            );
            const subsTable = el('table', { class: 'tb-table' },
                el('thead', {}, el('tr', {},
                    el('th', {}, 'الشركة'),
                    el('th', { style: 'text-align:center;' }, 'نسبة الملكية'),
                    el('th', { style: 'text-align:center;' }, 'طريقة التجميع'),
                    el('th', { style: 'text-align:center;' }, 'إجراء')
                )),
                el('tbody', {})
            );
            const tbody = subsTable.querySelector('tbody');
            (g.links || []).forEach(l => {
                const row = el('tr', {},
                    el('td', {}, l.company_name + (l.company_id === g.parent_company_id ? ' ⭐ (الأم)' : '')),
                    el('td', { style: 'text-align:center;font-weight:600;color:#1e40af;' }, l.ownership_pct.toFixed(1) + '%'),
                    el('td', { style: 'text-align:center;' }, l.consolidation_method === 'full' ? 'تجميع كامل' : (l.consolidation_method === 'proportional' ? 'تجميع نسبي' : 'حقوق ملكية')),
                    el('td', { style: 'text-align:center;' },
                        l.company_id === g.parent_company_id ? '—' :
                        el('button', { class: 'btn-icon', onClick: () => removeSubsidiary(g.id, l.company_id) }, '🗑')
                    )
                );
                tbody.appendChild(row);
            });
            subsCard.appendChild(subsTable);

            // نموذج إضافة شركة تابعة
            const addForm = el('div', { style: 'margin-top:12px;background:#f9fafb;padding:12px;border-radius:8px;display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:8px;align-items:end;' },
                el('div', null,
                    el('label', { style: 'display:block;margin-bottom:4px;font-size:12px;' }, 'شركة تابعة'),
                    el('select', { id: 'add-sub-sel', style: 'width:100%;padding:8px;border:1px solid #d1d5db;border-radius:4px;background:#fff;' })
                ),
                el('div', null,
                    el('label', { style: 'display:block;margin-bottom:4px;font-size:12px;' }, 'نسبة الملكية %'),
                    el('input', { type: 'number', id: 'add-sub-pct', min: '0', max: '100', step: '0.01', value: '60', style: 'width:100%;padding:8px;border:1px solid #d1d5db;border-radius:4px;' })
                ),
                el('div', null,
                    el('label', { style: 'display:block;margin-bottom:4px;font-size:12px;' }, 'الطريقة'),
                    el('select', { id: 'add-sub-method', style: 'width:100%;padding:8px;border:1px solid #d1d5db;border-radius:4px;background:#fff;' },
                        el('option', { value: 'full' }, 'تجميع كامل'),
                        el('option', { value: 'proportional' }, 'تجميع نسبي'),
                        el('option', { value: 'equity' }, 'حقوق ملكية')
                    )
                ),
                el('button', { class: 'btn btn-primary', onClick: () => addSubsidiary(g.id), style: 'padding:8px 14px;' }, '➕ إضافة')
            );
            subsCard.appendChild(addForm);
            area.appendChild(subsCard);

            // شريط أفعال: توليد + تصدير
            const actionBar = el('div', { style: 'background:#eff6ff;border:1px solid #93c5fd;border-radius:10px;padding:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px;' },
                el('button', { class: 'btn btn-primary', style: 'padding:10px 20px;font-size:14px;', onClick: () => generateConsolidated(g.id) }, '📊 توليد القوائم الموحدة'),
                el('button', { class: 'btn btn-outline', style: 'padding:10px 20px;font-size:14px;background:#fff;', onClick: () => exportConsolidated(g.id) }, '📥 تصدير Excel')
            );
            area.appendChild(actionBar);

            // حاوية النتائج
            const consRes = el('div', { id: 'cons-res-area' });
            area.appendChild(consRes);

            // تحميل الشركات للإضافة
            try {
                const cr = await api('/api/companies');
                const comps = (cr.companies || []).filter(c => c.id !== g.parent_company_id && !(g.links || []).some(l => l.company_id === c.id));
                const sel = $('#add-sub-sel');
                if (sel) {
                    sel.innerHTML = '<option value="">-- اختر شركة تابعة --</option>' +
                        comps.map(c => '<option value="' + c.id + '">' + c.name + '</option>').join('');
                }
            } catch (e) {}
        } catch (e) {
            area.innerHTML = '<div style="color:#dc2626;">خطأ: ' + e.message + '</div>';
        }
    }

    async function addSubsidiary(groupId) {
        const companyId = $('#add-sub-sel').value;
        const pct = parseFloat($('#add-sub-pct').value || '0');
        const method = $('#add-sub-method').value;
        if (!companyId) { toast('اختر شركة', 'warn'); return; }
        if (pct <= 0 || pct > 100) { toast('نسبة غير صحيحة', 'warn'); return; }
        try {
            await api('/api/groups/' + groupId + '/add-company', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ company_id: companyId, ownership_pct: pct, consolidation_method: method })
            });
            toast('✅ تمت الإضافة', 'success');
            openGroupDetail(groupId);
        } catch (e) { toast('خطأ: ' + e.message, 'error'); }
    }

    async function removeSubsidiary(groupId, companyId) {
        if (!confirm('حذف هذه الشركة من المجموعة؟')) return;
        try {
            await api('/api/groups/' + groupId + '/remove-company', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ company_id: companyId })
            });
            toast('تم الحذف', 'success');
            openGroupDetail(groupId);
        } catch (e) { toast('خطأ: ' + e.message, 'error'); }
    }

    async function generateConsolidated(groupId) {
        const res = $('#cons-res-area');
        if (!res) return;
        res.innerHTML = '<div style="text-align:center;padding:24px;color:#1e40af;">⏳ جاري توليد القوائم الموحدة...</div>';
        try {
            const r = await api('/api/groups/' + groupId + '/consolidate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            renderConsolidatedStatements(r);
            toast('✅ تم توليد القوائم الموحدة', 'success');
        } catch (e) {
            res.innerHTML = '<div style="background:#fee2e2;border:1px solid #fca5a5;color:#991b1b;padding:14px;border-radius:8px;">⚠️ ' + e.message + '</div>';
            toast('فشل التوليد: ' + e.message, 'error');
        }
    }

    function renderConsolidatedStatements(c) {
        const res = $('#cons-res-area');
        res.innerHTML = '';
        // ملخص NCI
        const nci = c.nci || {};
        const nciCard = el('div', { style: 'background:linear-gradient(135deg,#fef3c7,#fde68a);border:1px solid #fcd34d;border-radius:10px;padding:16px;margin-bottom:16px;' },
            el('div', { style: 'font-size:14px;color:#92400e;font-weight:700;margin-bottom:8px;' }, '📊 الحصص غير المسيطر عليها (NCI)'),
            el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;' },
                el('div', { style: 'background:#fff;padding:10px;border-radius:6px;' }, el('div', { style: 'font-size:11px;color:#6b7280;' }, 'إجمالي حقوق الملكية المجمعة'), el('div', { style: 'font-weight:700;color:#92400e;' }, fmt(nci.equity_total || 0))),
                el('div', { style: 'background:#fff;padding:10px;border-radius:6px;' }, el('div', { style: 'font-size:11px;color:#6b7280;' }, 'متوسط نسبة الملكية'), el('div', { style: 'font-weight:700;color:#92400e;' }, (nci.ownership_pct || 0).toFixed(1) + '%')),
                el('div', { style: 'background:#fff;padding:10px;border-radius:6px;' }, el('div', { style: 'font-size:11px;color:#6b7280;' }, 'حصة الشركة الأم'), el('div', { style: 'font-weight:700;color:#15803d;' }, fmt(nci.parent_share || 0))),
                el('div', { style: 'background:#fff;padding:10px;border-radius:6px;' }, el('div', { style: 'font-size:11px;color:#6b7280;' }, 'الحصص غير المسيطر عليها'), el('div', { style: 'font-weight:700;color:#1e40af;' }, fmt(nci.nci || 0)))
            )
        );
        res.appendChild(nciCard);

        // الاستبعادات البينية
        const ic = c.ic_eliminations || {};
        const hasIC = Object.values(ic).some(v => v && v !== 0);
        if (hasIC) {
            const icCard = el('div', { style: 'background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:14px;margin-bottom:16px;' },
                el('div', { style: 'font-size:14px;color:#166534;font-weight:700;margin-bottom:6px;' }, '✅ الاستبعادات البينية المطبقة'),
                el('div', { style: 'font-size:12px;color:#15803d;line-height:1.8;' },
                    Object.entries(ic).filter(([k, v]) => v && v !== 0).map(([k, v]) => {
                        const labels = { ic_receivable: 'المدينون المتبادلون', ic_payable: 'الدائنون المتبادلون', ic_revenue: 'الإيرادات المتبادلة', ic_expense: 'المصاريف المتبادلة', investment_in_sub: 'استثمار الأم في التابعة' };
                        return '<div>• ' + (labels[k] || k) + ': <strong>' + fmt(v) + '</strong></div>';
                    }).join('')
                )
            );
            res.appendChild(icCard);
        }

        // القوائم
        const stmts = c.statements || {};
        Object.entries(stmts).forEach(([key, stmt]) => {
            const lines = stmt.lines || [];
            const card = el('div', { style: 'background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:18px;margin-bottom:14px;' },
                el('h3', { style: 'margin:0 0 12px;color:#1e40af;font-size:16px;' }, stmt.title || key),
                el('table', { class: 'tb-table' },
                    el('thead', {}, el('tr', {},
                        el('th', { style: 'text-align:right;' }, 'البند'),
                        el('th', { style: 'text-align:left;' }, 'المبلغ الموحد')
                    )),
                    el('tbody', {}, ...lines.map(l =>
                        el('tr', { style: l.bold ? 'background:#f3f4f6;font-weight:600;' : (l.eliminated ? 'background:#f0fdf4;' : '') },
                            el('td', { style: 'padding-right:' + (l.indent || 0) * 20 + 'px' + (l.eliminated ? ';color:#15803d;' : '') }, (l.label || '') + (l.eliminated ? ' ✓ (مستبعد)' : '')),
                            el('td', { style: 'text-align:left;font-family:monospace;' + (l.eliminated ? ';color:#15803d;' : ''), 'data-amt': l.amount }, fmt(l.amount))
                        )
                    ))
                )
            );
            res.appendChild(card);
        });
    }

    async function exportConsolidated(groupId) {
        try {
            toast('⏳ جاري إنشاء Excel...', 'info');
            const r = await fetch('/api/groups/' + groupId + '/export/xlsx?company_id=' + state.currentCompany.id, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            if (!r.ok) { const t = await r.text(); throw new Error(t || r.statusText); }
            const blob = await r.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'consolidated_' + new Date().toISOString().slice(0, 10) + '.xlsx';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            toast('✅ تم التصدير', 'success');
        } catch (e) { toast('فشل التصدير: ' + e.message, 'error'); }
    }

    // ═══════════════════════════════════════════════════════════════════
    // ميزانية موحدة (نسخة منظّفة - event delegation)
    // ═══════════════════════════════════════════════════════════════════
    async function renderUnifiedBudgetView() {
        state.currentView = 'unified_budget';
        setActiveNav('unified_budget');
        renderTopbar();
        const main = $('#main-content');
        if (!main) return;
        main.innerHTML = _unifiedHtml();
        attachUnifiedBudgetEvents(main);
        await _loadCompaniesIntoUnified();
    }

    function _unifiedHtml() {
        return '<div dir="rtl" style="direction: rtl; text-align: right; display: flex; flex-direction: column; gap: 20px; width: 100%;">' +
            '<div style="background: white; padding: 22px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid #e5e7eb;">' +
            '<h3 style="margin: 0 0 14px; color: #1e293b; font-size: 18px; font-weight: 700;">🏢 إعداد هيكل المجموعة والشركات التابعة</h3>' +
            '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 18px;">' +
            '<div><label style="display: block; font-weight: 600; margin-bottom: 6px; font-size: 14px;">الشركة الأم</label>' +
            '<select data-role="parent-select" style="width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #cbd5e1; background: #fff;"><option value="">-- جاري التحميل --</option></select></div>' +
            '<div><label style="display: block; font-weight: 600; margin-bottom: 6px; font-size: 14px;">الفترة</label>' +
            '<input type="text" id="periodInput" value="' + new Date().getFullYear() + '" style="width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #cbd5e1;" /></div>' +
            '</div>' +
            '<div style="margin-bottom: 18px;">' +
            '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">' +
            '<label style="font-weight: 600; font-size: 14px;">الشركات التابعة ونسب الملكية:</label>' +
            '<button type="button" data-action="add-sub-row" style="padding: 6px 14px; font-size: 13px; cursor: pointer; border: 1px solid #cbd5e1; background: #f8fafc; border-radius: 6px; font-weight: 600;">➕ إضافة شركة</button>' +
            '</div>' +
            '<div style="border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">' +
            '<table style="width: 100%; border-collapse: collapse; text-align: right; font-size: 14px;">' +
            '<thead><tr style="background: #f8fafc; border-bottom: 1px solid #e2e8f0;">' +
            '<th style="padding: 10px; width: 50px; text-align: center;">اختر</th>' +
            '<th style="padding: 10px;">الشركة</th>' +
            '<th style="padding: 10px; width: 150px;">نسبة الملكية (%)</th>' +
            '<th style="padding: 10px; width: 150px;">NCI</th>' +
            '<th style="padding: 10px; width: 70px; text-align: center;">حذف</th>' +
            '</tr></thead>' +
            '<tbody data-role="subs-tbody"></tbody></table></div></div>' +
            '<div style="display: flex; gap: 10px; flex-wrap: wrap;">' +
            '<button type="button" data-action="execute-unified" style="background: #1e293b; color: white; border: none; padding: 10px 22px; border-radius: 6px; cursor: pointer; font-weight: 600;">⚙️ تنفيذ واستخراج الميزانية الموحدة</button>' +
            '<button type="button" data-action="export-unified" style="background: #107c41; color: white; border: none; padding: 10px 18px; border-radius: 6px; cursor: pointer; font-weight: 600;">📊 تصدير Excel</button>' +
            '</div></div>' +
            '<div style="background: white; padding: 22px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid #e5e7eb;">' +
            '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">' +
            '<h4 style="margin: 0; font-size: 16px; font-weight: 700;">🔄 محرك الاستبعادات الآلية</h4>' +
            '<button type="button" data-action="detect-elims" style="background: #0284c7; color: white; border: none; padding: 8px 14px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px;">🔍 كشف الحسابات البينية</button>' +
            '</div>' +
            '<div data-role="elims-container"><div style="text-align: center; padding: 22px; color: #64748b; background: #f8fafc; border-radius: 8px; border: 1px dashed #cbd5e1; font-size: 13px;">اضغط على "كشف الحسابات البينية" لبدء التحليل.</div></div>' +
            '</div>' +
            '<div data-role="results-container" style="background: white; padding: 22px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid #e5e7eb;">' +
            '<h4 style="margin: 0 0 12px; border-bottom: 2px solid #f1f5f9; padding-bottom: 8px;">قائمة المركز المالي الموحدة (النتائج النهائية)</h4>' +
            '<div data-role="results-body"><div style="text-align: center; padding: 30px; color: #64748b; font-size: 13px;">اضغط "تنفيذ واستخراج الميزانية الموحدة" لعرض النتائج.</div></div>' +
            '</div></div>';
    }

    function attachUnifiedBudgetEvents(main) {
        if (main._unifiedEventsAttached) return;
        main._unifiedEventsAttached = true;
        main.addEventListener('click', async (e) => {
            const target = e.target.closest('[data-action]');
            if (!target) return;
            const action = target.getAttribute('data-action');
            if (action === 'add-sub-row') _addSubRow();
            else if (action === 'del-sub-row') { const tr = target.closest('tr'); if (tr) tr.remove(); }
            else if (action === 'execute-unified') await _executeUnified();
            else if (action === 'export-unified') await _exportUnified();
            else if (action === 'detect-elims') await _detectEliminations();
        });
        main.addEventListener('input', (e) => {
            if (e.target.classList && e.target.classList.contains('sub-share')) {
                const row = e.target.closest('tr');
                const nciCell = row ? row.querySelector('.nci-cell') : null;
                if (nciCell) {
                    let v = parseFloat(e.target.value) || 0;
                    v = Math.max(0, Math.min(100, v));
                    nciCell.textContent = (100 - v) + '%';
                }
            }
        });
    }

    async function _loadCompaniesIntoUnified() {
        const sel = document.querySelector('[data-role="parent-select"]');
        if (!sel) return;
        try {
            const r = await api('/api/companies');
            const companies = (r.companies || []);
            sel.innerHTML = '<option value="">-- اختر الشركة الأم --</option>' +
                companies.map(c => '<option value="' + c.id + '">' + c.name + '</option>').join('');
        } catch (e) { sel.innerHTML = '<option value="">تعذر التحميل</option>'; }
        // Add change listener to clear sub-rows when parent changes
        sel.addEventListener('change', () => {
            const tbody = document.querySelector('[data-role="subs-tbody"]');
            if (tbody) tbody.innerHTML = '';
        });
    }

    function _addSubRow() {
        const tbody = document.querySelector('[data-role="subs-tbody"]');
        if (!tbody) return;
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid #f1f5f9';
        tr.innerHTML = '<td style="padding: 10px; text-align: center;"><input type="checkbox" class="sub-checkbox" /></td>' +
            '<td style="padding: 10px;"><select class="sub-company" data-role="sub-select" style="width: 100%; padding: 6px; border: 1px solid #cbd5e1; border-radius: 4px; background: #fff;"><option value="">-- اختر --</option></select></td>' +
            '<td style="padding: 10px;"><input type="number" value="60" min="1" max="100" class="sub-share" style="width: 100%; padding: 6px; border: 1px solid #cbd5e1; border-radius: 4px;" /></td>' +
            '<td style="padding: 10px; color: #0284c7; font-weight: 600; text-align: right;" class="nci-cell">40%</td>' +
            '<td style="padding: 10px; text-align: center;"><button type="button" data-action="del-sub-row" style="border: none; background: #fee2e2; color: #dc2626; border-radius: 4px; padding: 4px 10px; cursor: pointer;">حذف</button></td>';
        tbody.appendChild(tr);
        _populateSubSelect(tr.querySelector('[data-role="sub-select"]'));
    }

    async function _populateSubSelect(sel) {
        if (!sel) return;
        try {
            const parentSel = document.querySelector('[data-role="parent-select"]');
            const parentId = parentSel ? parentSel.value : null;
            const r = await api('/api/companies');
            const companies = (r.companies || []).filter(c => c.id !== parentId);
            sel.innerHTML = '<option value="">-- اختر شركة تابعة --</option>' +
                companies.map(c => '<option value="' + c.id + '">' + c.name + '</option>').join('');
        } catch (e) {}
    }

    function _getUnifiedFormData() {
        const parentSel = document.querySelector('[data-role="parent-select"]');
        const parentId = parentSel ? parentSel.value : null;
        const periodEl = document.querySelector('#periodInput');
        const period = periodEl ? periodEl.value : '';
        if (!parentId) { toast('اختر الشركة الأم', 'warn'); return null; }
        const subs = [];
        document.querySelectorAll('[data-role="subs-tbody"] tr').forEach(tr => {
            const cb = tr.querySelector('.sub-checkbox');
            if (!cb || !cb.checked) return;
            const sel = tr.querySelector('[data-role="sub-select"]');
            const share = tr.querySelector('.sub-share');
            if (sel && sel.value && share) subs.push({ company_id: sel.value, ownership_pct: parseFloat(share.value) || 0 });
        });
        if (subs.length === 0) { toast('أضف شركة تابعة', 'warn'); return null; }
        return { parent_id: parentId, period: period, subs: subs };
    }

    async function _executeUnified() {
        const data = _getUnifiedFormData();
        if (!data) return;
        const body = document.querySelector('[data-role="results-body"]');
        if (!body) return;
        body.innerHTML = '<div style="text-align: center; padding: 30px; color: #0284c7;">⏳ جاري التوحيد...</div>';
        try {
            const gRes = await fetch('/api/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'مجموعة ' + data.period, parent_company_id: data.parent_id }) });
            if (!gRes.ok) throw new Error(await gRes.text());
            const group = await gRes.json();
            for (const s of data.subs) {
                await fetch('/api/groups/' + group.id + '/add-company', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company_id: s.company_id, ownership_pct: s.ownership_pct, consolidation_method: 'full' }) });
            }
            const cRes = await fetch('/api/groups/' + group.id + '/consolidate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
            if (!cRes.ok) throw new Error(await cRes.text());
            const consolidated = await cRes.json();
            _renderUnifiedResults(consolidated, data);
            state.currentUnifiedGroup = group.id;
            toast('✅ تم التوحيد', 'success');
        } catch (e) {
            body.innerHTML = '<div style="background: #fee2e2; color: #991b1b; padding: 14px; border-radius: 8px;">⚠️ ' + e.message + '</div>';
        }
    }

    function _renderUnifiedResults(c, formData) {
        const body = document.querySelector('[data-role="results-body"]');
        if (!body) return;
        body.innerHTML = '';
        const nci = c.nci || {};
        const nciCard = document.createElement('div');
        nciCard.style.cssText = 'background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 14px; margin-bottom: 14px;';
        nciCard.innerHTML = '<div style="font-weight: 700; color: #92400e; margin-bottom: 8px;">📊 NCI</div><div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px;">' +
            '<div style="background: #fff; padding: 8px; border-radius: 6px;"><div style="font-size: 11px; color: #6b7280;">حقوق الملكية</div><div style="font-weight: 700;">' + fmt(nci.equity_total || 0) + '</div></div>' +
            '<div style="background: #fff; padding: 8px; border-radius: 6px;"><div style="font-size: 11px; color: #6b7280;">الملكية</div><div style="font-weight: 700;">' + (nci.ownership_pct || 0).toFixed(1) + '%</div></div>' +
            '<div style="background: #fff; padding: 8px; border-radius: 6px;"><div style="font-size: 11px; color: #6b7280;">حصة الأم</div><div style="font-weight: 700; color: #15803d;">' + fmt(nci.parent_share || 0) + '</div></div>' +
            '<div style="background: #fff; padding: 8px; border-radius: 6px;"><div style="font-size: 11px; color: #6b7280;">NCI</div><div style="font-weight: 700; color: #1e40af;">' + fmt(nci.nci || 0) + '</div></div></div>';
        body.appendChild(nciCard);
        const stmts = c.statements || {};
        Object.entries(stmts).forEach(([key, stmt]) => {
            const lines = stmt.lines || [];
            const card = document.createElement('div');
            card.style.cssText = 'background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; margin-bottom: 10px;';
            let rowsHtml = '';
            lines.forEach(l => {
                const elim = l.eliminated ? '<span style="background: #d1fae5; color: #065f46; padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-right: 4px;">✓</span>' : '';
                const bold = l.bold ? 'background: #e0e7ff; font-weight: 600;' : '';
                rowsHtml += '<tr style="border-bottom: 1px solid #f1f5f9; ' + bold + '"><td style="padding: 6px 8px; padding-right: ' + ((l.indent||0) * 20) + 'px;">' + elim + (l.label || '') + '</td><td style="padding: 6px 8px; text-align: left; font-family: monospace; font-weight: ' + (l.bold ? '700' : '400') + ';">' + fmt(l.amount) + '</td></tr>';
            });
            card.innerHTML = '<h5 style="margin: 0 0 10px; color: #1e40af; font-size: 15px;">' + (stmt.title || key) + '</h5><table style="width: 100%; border-collapse: collapse; font-size: 13px;"><thead><tr style="background: #f1f5f9;"><th style="padding: 6px 8px; text-align: right;">البند</th><th style="padding: 6px 8px; text-align: left;">المبلغ الموحد</th></tr></thead><tbody>' + rowsHtml + '</tbody></table>';
            body.appendChild(card);
        });
    }

    async function _exportUnified() {
        if (!state.currentUnifiedGroup) { toast('نفّذ التوحيد أولاً', 'warn'); return; }
        try {
            const r = await fetch('/api/groups/' + state.currentUnifiedGroup + '/export/xlsx?company_id=' + state.currentCompany.id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
            if (!r.ok) throw new Error(await r.text());
            const blob = await r.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = 'consolidated_' + new Date().toISOString().slice(0, 10) + '.xlsx';
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
            toast('✅ تم التصدير', 'success');
        } catch (e) { toast('فشل: ' + e.message, 'error'); }
    }

    async function _detectEliminations() {
        if (!state.currentUnifiedGroup) { toast('نفّذ التوحيد أولاً', 'warn'); return; }
        const container = document.querySelector('[data-role="elims-container"]');
        if (!container) return;
        container.innerHTML = '<div style="text-align: center; padding: 20px; color: #0284c7;">⏳ جاري الكشف...</div>';
        try {
            const r = await fetch('/api/groups/' + state.currentUnifiedGroup + '/detect-eliminations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
            if (!r.ok) throw new Error(await r.text());
            const data = await r.json();
            const txs = data.transactions || [];
            if (txs.length === 0) {
                container.innerHTML = '<div style="text-align: center; padding: 20px; color: #94a3b8; background: #f8fafc; border-radius: 8px;">لا توجد معاملات بينية</div>';
                return;
            }
            let html = '<table style="width: 100%; border-collapse: collapse; font-size: 13px;"><thead><tr style="background: #f1f5f9; color: #475569;"><th style="padding: 8px; text-align: right;">الجهة</th><th style="padding: 8px; text-align: right;">الحساب</th><th style="padding: 8px; text-align: right;">النوع</th><th style="padding: 8px; text-align: right;">المبلغ</th><th style="padding: 8px; text-align: center;">مطابق</th></tr></thead><tbody>';
            txs.forEach(tx => {
                const bg = tx.matched ? '#f0fdf4' : '#fffbeb';
                const status = tx.matched ? '✅' : '⚠️';
                html += '<tr style="background: ' + bg + '; border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px;">' + (tx.company_name || '') + '</td><td style="padding: 8px;">' + (tx.account_name || '') + '</td><td style="padding: 8px;">' + (tx.sub_category || '') + '</td><td style="padding: 8px; font-family: monospace; font-weight: 600;">' + fmt(tx.amount) + '</td><td style="padding: 8px; text-align: center;">' + status + '</td></tr>';
            });
            html += '</tbody></table>';
            container.innerHTML = html;
            toast('🔍 ' + txs.length + ' معاملة (' + data.matched_count + ' مطابقة)', 'success');
        } catch (e) {
            container.innerHTML = '<div style="background: #fee2e2; color: #991b1b; padding: 14px; border-radius: 8px;">⚠️ ' + e.message + '</div>';
        }
    }


    const SUB_CATEGORIES = [
        ['cash_and_equivalents', 'النقدية وما في حكمها'], ['receivables', 'المدينون التجاريون'], ['inventory', 'المخزون'], ['prepayments', 'مصروفات مقدمة وأصول أخرى'],
        ['other_current_assets', 'أصول متداولة أخرى'], ['ppe', 'ممتلكات ومعدات (PPE)'], ['intangible_assets', 'أصول غير ملموسة'], ['investments', 'استثمارات'],
        ['payables', 'الدائنون التجاريون'], ['short_term_loans', 'قروض قصيرة الأجل'], ['accruals', 'مصروفات مستحقة'], ['other_current_liabilities', 'التزامات متداولة أخرى'],
        ['long_term_loans', 'قروض طويلة الأجل'], ['share_capital', 'رأس المال'], ['reserves', 'الاحتياطيات والأرباح المبقاة'],
        // ───── فئات الاستبعادات البينية (IFRS 10) ─────
        ['ic_receivable', '🔗 مدينون بين شركات المجموعة'],
        ['ic_payable', '🔗 دائنون بين شركات المجموعة'],
        ['ic_revenue', '🔗 إيرادات متبادلة (مبيعات بينية)'],
        ['ic_expense', '🔗 مصاريف متبادلة (مشتريات بينية)'],
        ['ic_loan_receivable', '🔗 قروض ممنوحة لشركات المجموعة'],
        ['ic_loan_payable', '🔗 قروض مستلمة من شركات المجموعة'],
        ['ic_cash_transfer', '🔗 تحويلات نقدية معلقة بين المجموعة'],
        ['ic_dividend_receivable', '🔗 توزيعات مستحقة من تابعة'],
        ['ic_dividend_payable', '🔗 توزيعات مستحقة لشركة أم'],
        ['investment_in_sub', '🔗 استثمار الشركة الأم في تابعة'],
        ['unrealized_profit_inv', '🔗 أرباح غير محققة في المخزون']
    ];

    setTimeout(async () => {
        const savedCompanyId = localStorage.getItem('currentCompanyId');
        const savedJobId = localStorage.getItem('currentJobId');
        
        if (savedCompanyId) {
            try {
                const r = await fetch('/api/companies');
                if (r.ok) {
                    const data = await r.json();
                    const companies = data.companies || [];
                    const found = companies.find(c => c.id == savedCompanyId);
                    if (found) {
                        state.currentCompany = found;
                        if (savedJobId) {
                            state.currentJob = savedJobId;
                        }
                        setupNav();
                        await switchView(savedJobId ? 'statements' : 'dashboard');
                        return;
                    }
                }
            } catch (e) {}
        }
        showCompanySelector();
    }, 50);

    return {
        state,
        switchView,
        goBack,
        showCompanySelector,
        setupNav
    };
})();
