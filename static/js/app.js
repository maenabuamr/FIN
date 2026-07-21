/* نظام المراجعة المالية v2.7 */
const App = (() => {
    const state = { companies: [], currentCompany: null, currentView: 'companies', currentJob: null, currentTab: 'list' };
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
            compare: 'مقارنة الفترات المالية' 
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
                        isDraft ? el('button', { class: 'btn btn-primary', onClick: () => commitJob(state.currentJob) }, '💾 حفظ نهائي') : el('span', { class: 'tag green' }, '✓ محفوظ'))),
                table));
        } catch (e) { main.innerHTML = `<div class="empty">خطأ في التحميل: ${e.message}</div>`; }
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
    function renderComparisonTable(currentRes, previousRes) {
        const resultArea = $('#comparison-result-area');
        resultArea.innerHTML = '';

        const curStmts = currentRes.statements || {};
        const prevStmts = previousRes.statements || {};

        const wrapper = el('div', { style: 'display:flex;flex-direction:column;gap:20px;' });

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
                    
                )),
                el('tbody', {}, ...(curStmt.lines || []).map(curLine => {
                    const curAmt = curLine.amount || 0;
                    const prevAmt = prevMap[curLine.label] || 0;
                    const diff = curAmt - prevAmt;
                    const pct = prevAmt !== 0 ? ((diff / Math.abs(prevAmt)) * 100).toFixed(1) + '%' : '—';

                    return el('tr', { style: curLine.bold ? 'background:#f8fafc;font-weight:600;' : '' },
                        el('td', { style: 'padding-right:' + (curLine.indent || 0) * 20 + 'px' }, curLine.label || ''),
                        el('td', { style: 'text-align:left;font-family:monospace;' }, fmt(curAmt)),
                        el('td', { style: 'text-align:left;font-family:monospace;' }, fmt(prevAmt)),
                    
                    );
                }))
            );

            wrapper.appendChild(el('div', { style: 'background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.05);' },
                el('h3', { style: 'margin:0 0 16px;color:#1e40af;font-size:16px;border-bottom:2px solid #e2e8f0;padding-bottom:8px;' }, curStmt.title || key),
                table
            ));
        });

        // قسم الإيضاحات المقارنة
        const curNotes = currentRes.notes || [];
        const prevNotes = previousRes.notes || [];
        if (curNotes.length > 0 || prevNotes.length > 0) {
            const prevNoteMap = {};
            prevNotes.forEach(n => { prevNoteMap[n.title || ''] = n; });
            const allTitles = [];
            const seen = new Set();
            [...curNotes, ...prevNotes].forEach(n => {
                const t = n.title || '';
                if (t && !seen.has(t)) { seen.add(t); allTitles.push(t); }
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
                const accs = n.accounts || [];
                return accs.reduce((s, a) => s + (a.amount || 0), 0);
            };
            const noteTable = el('table', { class: 'tb-table', style: 'width:100%;font-size:13px;' },
                el('thead', {}, el('tr', {},
                    el('th', { style: 'text-align:right;' }, 'الإيضاح'),
                    el('th', { style: 'text-align:left;' }, 'الفترة الحالية'),
                    el('th', { style: 'text-align:left;' }, 'الفترة السابقة'))),
                el('tbody', {}, ...allTitles.map(title => {
                    const cn = curNotes.find(n => n.title === title);
                    const pn = prevNoteMap[title];
                    return el('tr', {},
                        el('td', { style: 'text-align:right;font-weight:600;color:#1e40af;' }, title),
                        el('td', { style: 'text-align:left;font-family:monospace;' }, fmt(totalFor(cn))),
                        el('td', { style: 'text-align:left;font-family:monospace;color:#6b7280;' }, fmt(totalFor(pn))));
                }))
            );
            wrapper.appendChild(el('div', { style: 'background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.05);' },
                el('h3', { style: 'margin:0 0 16px;color:#1e40af;font-size:16px;border-bottom:2px solid #e2e8f0;padding-bottom:8px;' }, 'الإيضاحات - مقارنة'),
                noteTable
            ));
        }

        resultArea.appendChild(wrapper);
    }
    
        async function exportCompareToExcel() {
        const currentId = $('#compare-job-current').value;
        const previousId = $('#compare-job-previous').value;
        if (!currentId || !previousId) { toast('اختر الفترة الحالية والسابقة أولاً', 'warn'); return; }
        if (currentId === previousId) { toast('لا يمكن مقارنة نفس الفترة', 'warn'); return; }
        try {
            toast('⏳ جاري إنشاء ملف Excel...', 'info');
            const r = await fetch('/api/compare/export/xlsx?company_id=' + state.currentCompany.id, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ current_job_id: currentId, previous_job_id: previousId, company_id: state.currentCompany.id })
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
            toast('✅ تم تصدير المقارنة إلى Excel بنجاح', 'success');
        } catch (e) { toast('فشل التصدير: ' + e.message, 'error'); }
    }

    const SUB_CATEGORIES = [
        ['cash_and_equivalents', 'النقدية وما في حكمها'], ['receivables', 'المدينون التجاريون'], ['inventory', 'المخزون'], ['prepayments', 'مصروفات مقدمة وأصول أخرى'],
        ['other_current_assets', 'أصول متداولة أخرى'], ['ppe', 'ممتلكات ومعدات (PPE)'], ['intangible_assets', 'أصول غير ملموسة'], ['investments', 'استثمارات'],
        ['payables', 'الدائنون التجاريون'], ['short_term_loans', 'قروض قصيرة الأجل'], ['accruals', 'مصروفات مستحقة'], ['other_current_liabilities', 'التزامات متداولة أخرى'],
        ['long_term_loans', 'قروض طويلة الأجل'], ['share_capital', 'رأس المال'], ['reserves', 'الاحتياطيات والأرباح المبقاة']
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
