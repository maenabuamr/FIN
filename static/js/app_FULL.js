const $=s=>document.querySelector(s);
const App={
state:{co:null,view:'co',job:null},
navs:[['dash','⌂','لوحة'],['tb','⚖','ميزان'],['st','📊','القوائم'],['nt','📝','الإيضاحات'],['cmp','⇄','المقارنة']],
go(v){this.state.view=v;this.paintNav();this.render()},
paintNav(){
const s=this.state,ns=$('#nav-section');
if(!ns)return;
if(!s.co){
ns.innerHTML='<a href="#" style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:6px;color:#9ca3af;text-decoration:none;cursor:not-allowed"><span>⌂</span><span>لوحة</span></a>';
return;
}
ns.innerHTML=this.navs.map(([k,i,l])=>{
const active=s.view===k;
return`<a href="#" onclick="App.go('${k}');return false" style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:6px;margin:2px 0;color:${active?'#fff':'#374151'};background:${active?'#1e40af':'transparent'};text-decoration:none;cursor:pointer"><span>${i}</span><span>${l}</span></a>`;
}).join('')+'<a href="#" onclick="App.go(\'co\');return false" style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:6px;margin:2px 0;color:#374151;text-decoration:none;cursor:pointer;margin-top:24px;border-top:1px solid #e5e7eb;padding-top:16px"><span>🔄</span><span>تبديل الشركة</span></a>'
},
async init(){this.paintNav();this.render()},
async render(){
const s=this.state;
const tb=document.querySelector('.topbar');
if(tb)tb.textContent={co:'اختر شركة',dash:'لوحة التحكم',tb:'ميزان المراجعة',st:'القوائم المالية',nt:'الإيضاحات',cmp:'المقارنات'}[s.view]||'';
const m=$('#main-content');
if(!m)return;

if(s.view==='co'||!s.co){
const r=await(await fetch('/api/companies')).json();
let cs=(r.companies||[]);
m.innerHTML=`
<div style="text-align:center;padding:40px 20px 20px">
<div style="font-size:64px">🏢</div>
<h1 style="color:#1e40af;margin:12px 0">مرحباً بك في نظام المراجعة المالية</h1>
<p style="color:#6b7280;font-size:16px">اختر شركة للعمل أو أنشئ شركة جديدة</p>
</div>
<div style="max-width:1200px;margin:20px auto;padding:0 20px">
<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin-bottom:20px">
<h2 style="margin-top:0">📁 الشركات (${cs.length})</h2>
${cs.length?`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px">${cs.map(c=>`
<div style="background:#fafbfc;border:1px solid #e5e7eb;border-radius:12px;padding:16px;text-align:center;position:relative">
<div onclick="App.sel('${c.id}')" style="cursor:pointer">
<div style="width:50px;height:50px;border-radius:50%;background:linear-gradient(135deg,#3b82f6,#1e40af);color:#fff;font-size:20px;line-height:50px;margin:0 auto 8px">${(c.name||'?').charAt(0)}</div>
<div style="font-size:15px;font-weight:600;margin-bottom:4px">${c.name||''}</div>
<div style="font-size:12px;color:#6b7280">${c.job_count||0} ميزان • ${c.currency||'ر.س'}</div>
${c.tax_id?`<div style="font-size:11px;color:#9ca3af;margin-top:4px">${c.tax_id}</div>`:''}
</div>
<div style="margin-top:8px;display:flex;gap:4px;justify-content:center">
<button onclick="App.editCo('${c.id}')" style="background:#e5e7eb;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px">✏️ تعديل</button>
<button onclick="App.delCo('${c.id}','${(c.name||'').replace(/'/g,"\\'")}')" style="background:#fee2e2;border:none;color:#dc2626;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px">🗑 حذف</button>
</div>
</div>`).join('')}</div>`:'<p style="text-align:center;color:#6b7280;padding:40px">لا توجد شركات</p>'}
</div>
<div style="background:#fff;border:2px dashed #d1d5db;border-radius:12px;padding:20px;max-width:600px;margin:0 auto">
<h2 style="margin-top:0">➕ إنشاء شركة جديدة</h2>
<div style="margin-bottom:12px"><label style="display:block;font-size:13px;margin-bottom:4px">اسم الشركة *</label><input type="text" id="new-name" placeholder="مثال: شركة الأمل" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box"></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
<div><label style="display:block;font-size:13px;margin-bottom:4px">الرقم الضريبي</label><input type="text" id="new-tax" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box"></div>
<div><label style="display:block;font-size:13px;margin-bottom:4px">العملة</label><input type="text" id="new-cur" value="ر.س" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box"></div>
</div>
<button onclick="App.createCo()" style="width:100%;background:#1e40af;color:#fff;border:none;padding:10px;border-radius:6px;cursor:pointer;font-size:15px">إنشاء</button>
</div>
</div>`;
return;
}

if(s.view==='dash'){
const r=(await(await fetch(`/api/jobs?company_id=${s.co.id}`)).json()).jobs||[];
const ok=r.filter(j=>['ready','committed','processed'].includes(j.status));
const dr=r.filter(j=>['uploaded','draft'].includes(j.status));
m.innerHTML=`
<div style="background:linear-gradient(135deg,#1e40af,#3b82f6);color:#fff;padding:24px;border-radius:12px;margin-bottom:20px">
<div style="display:flex;justify-content:space-between;align-items:start">
<div>
<div style="font-size:13px;opacity:0.85">📁 ملف الشركة</div>
<div style="font-size:28px;font-weight:700;margin:4px 0">${s.co.name}</div>
<div style="font-size:14px;opacity:0.9">${s.co.tax_id?'الرقم الضريبي: '+s.co.tax_id+' • ':''}العملة: ${s.co.currency||'ر.س'}</div>
</div>
<button onclick="App.editCo('${s.co.id}')" style="background:rgba(255,255,255,0.2);color:#fff;border:1px solid rgba(255,255,255,0.3);padding:6px 14px;border-radius:6px;cursor:pointer">✏️ تعديل</button>
</div>
</div>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px">
<div style="background:#fff;padding:16px;border-radius:8px;border:1px solid #e5e7eb"><div style="font-size:12px;color:#6b7280">محفوظة</div><div style="font-size:24px;font-weight:700">${ok.length}</div></div>
<div style="background:#fff;padding:16px;border-radius:8px;border:1px solid #e5e7eb"><div style="font-size:12px;color:#6b7280">مسودات</div><div style="font-size:24px;font-weight:700;color:${dr.length?'#f59e0b':'#9ca3af'}">${dr.length}</div></div>
<div style="background:#fff;padding:16px;border-radius:8px;border:1px solid #e5e7eb"><div style="font-size:12px;color:#6b7280">إجمالي حسابات</div><div style="font-size:24px;font-weight:700">${ok.reduce((s,j)=>s+(j.account_count||0),0)}</div></div>
</div>
<button onclick="App.go('tb')" style="background:#1e40af;color:#fff;border:none;padding:12px 24px;border-radius:6px;cursor:pointer;font-size:15px;margin-bottom:20px">📤 رفع ميزان جديد</button>
${ok.length?`<h2 style="margin-top:20px">✅ المحفوظة (${ok.length})</h2><div>${ok.map(j=>`<div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin:8px 0;display:flex;justify-content:space-between;align-items:center"><div><b>${j.filename||'-'}</b><br><small style="color:#6b7280">${j.account_count} حساب</small></div><button onclick="App.open('${j.job_id}')" style="background:#1e40af;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer">فتح</button></div>`).join('')}</div>`:''}
${dr.length?`<h2 style="margin-top:20px;color:#92400e">📝 مسودات (${dr.length})</h2><div>${dr.map(j=>`<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:12px;margin:8px 0;display:flex;justify-content:space-between;align-items:center"><div><b>${j.filename||'-'}</b><br><small>${j.account_count} حساب</small></div><div><button onclick="App.commit('${j.job_id}')" style="background:#1e40af;color:#fff;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;margin-left:4px">💾 حفظ</button><button onclick="App.delJob('${j.job_id}')" style="background:#fee2e2;color:#dc2626;border:none;padding:6px 12px;border-radius:6px;cursor:pointer">🗑</button></div></div>`).join('')}</div>`:''}`;
}
else if(s.view==='tb'){
m.innerHTML=`<h2>⚖️ ميزان المراجعة</h2><div style="background:#fff;border:2px dashed #d1d5db;border-radius:8px;padding:40px;text-align:center;cursor:pointer" onclick="$('#f').click()"><div style="font-size:48px">📤</div><div style="font-size:18px;margin:12px 0">اضغط لرفع ملف</div><div style="color:#6b7280;font-size:14px">Excel / PDF / CSV</div></div><input type="file" id="f" style="display:none" onchange="App.up(this.files[0])">`;
}
else if(s.view==='st'){
if(!s.job){m.innerHTML='<div style="text-align:center;padding:40px;color:#6b7280">اختر ميزان من لوحة التحكم</div>';return}
m.innerHTML='<h2>📊 القوائم</h2><div style="padding:20px;text-align:center;color:#6b7280">⏳ جاري التحميل...</div>';
try{
const r=await(await fetch(`/api/statements/${s.job}?company_id=${s.co.id}`)).json();
const t=r.totals||{};
const a=t.assets?.total_assets||0,l=t.liabilities?.total_liabilities||0,e=t.equity?.total_equity||0,bal=Math.abs(a-(l+e))<0.01;
let html=`<div style="background:${bal?'#f0fdf4':'#fef2f2'};border:2px solid ${bal?'#86efac':'#fca5a5'};border-radius:12px;padding:20px;margin-bottom:20px"><div style="display:flex;align-items:center;gap:12px"><div style="font-size:32px">${bal?'✅':'❌'}</div><div style="font-size:20px;font-weight:700;color:${bal?'#15803d':'#991b1b'}">${bal?'الميزان متوازن':'غير متوازن'}</div></div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:12px"><div style="background:#fff;padding:12px;border-radius:8px"><div style="font-size:12px;color:#6b7280">الأصول</div><div style="font-size:18px;font-weight:700">${a.toFixed(2)}</div></div><div style="background:#fff;padding:12px;border-radius:8px"><div style="font-size:12px;color:#6b7280">الالتزامات</div><div style="font-size:18px;font-weight:700">${l.toFixed(2)}</div></div><div style="background:#fff;padding:12px;border-radius:8px"><div style="font-size:12px;color:#6b7280">الملكية</div><div style="font-size:18px;font-weight:700">${e.toFixed(2)}</div></div></div></div><div style="margin-bottom:16px"><button onclick="App.exp('xlsx')" style="background:#1e40af;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;margin-left:8px">📥 Excel</button><button onclick="App.exp('pdf')" style="background:#dc2626;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer">📥 PDF</button></div>`;
Object.entries(r.statements||{}).forEach(([k,v])=>{
html+=`<div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:16px"><h3 style="margin:0 0 12px;color:#1e40af;border-bottom:2px solid #1e40af;padding-bottom:8px">${v.title||k}</h3><table style="width:100%">${(v.lines||[]).map(l=>`<tr style="${l.bold?'background:#f3f4f6;font-weight:600':''}"><td style="padding:6px;padding-right:${(l.indent||0)*20}px">${l.label||''}</td><td style="text-align:left;padding:6px;font-family:monospace">${(l.amount||0).toFixed(2)}</td></tr>`).join('')}</table></div>`;
});
m.innerHTML=html
}catch(err){m.innerHTML='<div style="padding:20px;text-align:center;color:#dc2626">خطأ: '+err.message+'</div>'}
}
else if(s.view==='nt'){
if(!s.job){m.innerHTML='<div style="text-align:center;padding:40px;color:#6b7280">اختر ميزان</div>';return}
m.innerHTML='<h2>📝 الإيضاحات</h2><div style="padding:20px;text-align:center;color:#6b7280">⏳...</div>';
try{
const r=(await(await fetch(`/api/notes/${s.job}?company_id=${s.co.id}`)).json()).notes||[];
m.innerHTML='<h2>📝 الإيضاحات ('+r.length+')</h2>'+(r.length?r.map(n=>`<div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:8px"><h3 style="margin:0 0 8px;color:#1e40af">${n.title||''}</h3><p style="margin:0">${n.body||''}</p></div>`).join(''):'<div style="text-align:center;padding:40px;color:#6b7280">لا توجد إيضاحات</div>')
}catch(err){m.innerHTML='<div style="padding:20px;text-align:center;color:#dc2626">'+err.message+'</div>'}
}
else if(s.view==='cmp'){
m.innerHTML=`<h2>⇄ المقارنات</h2><div style="background:#fff;padding:20px;border-radius:8px;border:1px solid #e5e7eb"><p>قارن بين فترتين مختلفتين لنفس الشركة.</p><p style="color:#6b7280">اختر فترتين من القوائم المحفوظة لعرض الفروقات.</p><p style="color:#9ca3af;font-size:13px">ملاحظة: تحتاج ميزانين محفوظين على الأقل للمقارنة.</p></div>`;
}
},
sel(id){
fetch('/api/companies').then(r=>r.json()).then(d=>{
this.state.co=(d.companies||[]).find(c=>c.id===id);
if(this.state.co)this.go('dash')
});
},
open(jid){this.state.job=jid;this.go('st')},
async createCo(){
const name=$('#new-name').value.trim();
if(!name)return alert('الاسم مطلوب');
const tax=$('#new-tax').value.trim();
const cur=$('#new-cur').value.trim()||'ر.س';
try{
const r=await fetch('/api/companies',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,tax_id:tax,currency:cur,notes:''})});
if(r.ok){
const c=await r.json();
alert('✅ تم إنشاء: '+c.name);
this.state.co=c;
this.go('dash');
}else alert('فشل الإنشاء: '+await r.text());
}catch(e){alert('خطأ: '+e.message)}
},
async editCo(id){
const r=await fetch('/api/companies').then(r=>r.json());
const c=(r.companies||[]).find(x=>x.id===id);
if(!c)return;
const name=prompt('اسم الشركة:',c.name);
if(name===null)return;
const tax=prompt('الرقم الضريبي:',c.tax_id||'');
if(tax===null)return;
const cur=prompt('العملة:',c.currency||'ر.س');
if(cur===null)return;
try{
const res=await fetch(`/api/companies/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,tax_id:tax,currency:cur,notes:c.notes||''})});
if(res.ok){
alert('✅ تم التعديل');
if(this.state.co&&this.state.co.id===id){
this.state.co={...this.state.co,name,tax_id:tax,currency:cur};
}
this.render();
}else alert('فشل: '+await res.text());
}catch(e){alert('خطأ: '+e.message)}
},
async delCo(id,name){
if(!confirm('حذف الشركة "'+name+'" وكل بياناتها؟'))return;
try{
const r=await fetch(`/api/companies/${id}`,{method:'DELETE'});
if(r.ok){
alert('✅ تم الحذف');
if(this.state.co&&this.state.co.id===id){this.state.co=null;this.state.view='co';this.paintNav();}
this.render();
}else alert('فشل: '+await r.text());
}catch(e){alert('خطأ: '+e.message)}
},
async commit(jid){
try{await fetch(`/api/jobs/${jid}/commit?company_id=${this.state.co.id}`,{method:'POST'});this.render();}catch(e){alert('خطأ')}
},
async delJob(jid){
if(!confirm('حذف هذا الميزان؟'))return;
try{await fetch(`/api/jobs/${jid}?company_id=${this.state.co.id}`,{method:'DELETE'});this.render();}catch(e){alert('خطأ')}
},
async exp(fmt){
try{
const r=await fetch(`/api/export/${fmt}/${this.state.job}?company_id=${this.state.co.id}`);
if(!r.ok)throw new Error('failed');
const b=await r.blob();
const u=URL.createObjectURL(b);
const a=document.createElement('a');a.href=u;a.download='report.'+fmt;document.body.appendChild(a);a.click();a.remove();
}catch(e){alert('خطأ: '+e.message)}
},
async up(f){
const fd=new FormData();
fd.append('file',f);
fd.append('company_name',this.state.co.name);
fd.append('period','2024');
fd.append('currency',this.state.co.currency||'ر.س');
const r=await fetch('/api/upload?company_id='+this.state.co.id,{method:'POST',body:fd});
if(r.ok){alert('✅ تم الرفع، ثم توليد القوائم');this.go('dash')}
else alert('فشل: '+await r.text())
}
};
document.addEventListener('DOMContentLoaded',()=>App.init());
