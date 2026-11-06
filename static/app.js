const $ = id => document.getElementById(id);
let token = sessionStorage.getItem("sales-token");
let session = null;
let currentScreen = "analysis";
let currentReport = null;
let currentBreakdown = "daily";
let record = null;
let batch = null;
let lines = [];
let reasons = {};

const STATUS = {recorded:"ჩაწერილი",missing:"გამოტოვებული",closed:"დახურული",unopened:"გაუხსნელი",nonworking:"არასამუშაო",pending:"მოლოდინში",approved:"დამტკიცებული",rejected:"უარყოფილი",ready:"მზად",unmapped:"დაუკავშირებელი",blocked:"შეჩერებული",conflict:"კონფლიქტი",duplicate:"დუბლიკატი",accepted:"მიღებული",replaced:"ჩანაცვლებული"};
const TITLES = {analysis:["ანალიზი","ანალიზი"],entry:["დღიური ჩანაწერი","დღიური ჩანაწერი"],records:["ჩანაწერები","ჩანაწერები"],import:["Excel იმპორტი","Excel იმპორტი"],corrections:["შესწორების მოთხოვნები","შესწორების მოთხოვნები"],manage:["მართვა","მართვა"],history:["ისტორია","ისტორია"]};
const weekdays = ["ორშაბათი","სამშაბათი","ოთხშაბათი","ხუთშაბათი","პარასკევი","შაბათი","კვირა"];
const monthNames = ["იანვარი","თებერვალი","მარტი","აპრილი","მაისი","ივნისი","ივლისი","აგვისტო","სექტემბერი","ოქტომბერი","ნოემბერი","დეკემბერი"];
const $all = selector => [...document.querySelectorAll(selector)];
const isoToday = () => session?.today || new Intl.DateTimeFormat("sv-SE", {timeZone:"Asia/Tbilisi"}).format(new Date());
const isoDate = d => new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,10);
const dateMinus = (date, days) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate()-days); return isoDate(d); };
const dateLabel = value => { if (!value) return "—"; const [y,m,d] = String(value).slice(0,10).split("-"); return `${d}.${m}.${y}`; };
const numeric = value => { const n = Number(value); return Number.isFinite(n) ? n : null; };
const money = (value, empty = "მონაცემი არ არის") => { const n = numeric(value); return n === null ? empty : new Intl.NumberFormat("ka-GE", {minimumFractionDigits:0, maximumFractionDigits:3}).format(n) + " ₾"; };
const metricMoney = (value, recorded = 0, empty = "მონაცემი არ არის") => {
  const n = numeric(value);
  const observations = Number(recorded) || 0;
  return n === null || (n === 0 && observations === 0) ? empty : money(value);
};
const metricMeta = (value, recorded = 0) => numeric(value) === 0 && (Number(recorded) || 0) > 0 ? "დადასტურებული ნული" : "";
const plainMoney = value => { const n = numeric(value); return n === null ? "—" : new Intl.NumberFormat("ka-GE", {minimumFractionDigits:0, maximumFractionDigits:3}).format(n); };
const pct = value => { const n = numeric(value); return n === null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`; };
const pctPlain = value => { const n = numeric(value); return n === null ? "—" : `${n.toFixed(1)}%`; };
const branchName = id => session?.branches?.find(b => b.id === id)?.name || id || "—";

function notify(message, error = false) {
  $("global-message").textContent = error ? message : "";
  const toast = $("toast");
  if (!message) { toast.className = "toast"; return; }
  toast.textContent = message; toast.className = `toast show${error ? " error" : ""}`;
  window.clearTimeout(notify.timer); notify.timer = window.setTimeout(() => toast.className = "toast", 3400);
}

async function api(path, {body, method, binary} = {}) {
  const headers = token ? {Authorization:`Bearer ${token}`} : {};
  if (body && !(body instanceof Blob)) headers["Content-Type"] = "application/json";
  const apiBase = String(window.BRANCH_SALES_API_BASE || "https://branch-sales-418.netlify.app").replace(/\/$/,"");
  const endpoint = apiBase === "/api" ? `${apiBase}/${path}` : `${apiBase}/api/${path}`;
  const response = await fetch(endpoint, {headers, method:method || (body ? "POST" : "GET"), body:body instanceof Blob ? body : body ? JSON.stringify(body) : undefined});
  if (!response.ok) {
    if (response.status === 401 && token) logout();
    let error = {}; try { error = await response.json(); } catch {}
    throw new Error([error.message,error.details].filter(Boolean).join(" · ") || "მოთხოვნა ვერ შესრულდა");
  }
  return binary ? response.blob() : response.json();
}

function run(action) { return async event => { event?.preventDefault(); const button = event?.submitter || (event?.currentTarget instanceof HTMLButtonElement ? event.currentTarget : null); if (button) button.disabled = true; try { await action(event); } catch (error) { notify(error.message, true); } finally { if (button) button.disabled = false; } }; }
function formData(form) { const data = Object.fromEntries(new FormData(form)); for (const input of form.querySelectorAll("input[type=checkbox]")) data[input.name] = input.checked; return data; }
function setOptions(select, entries, blank) { const previous = select.multiple ? [...select.selectedOptions].map(o=>o.value) : select.value; select.replaceChildren(); if (blank) select.add(new Option(blank, "")); entries.forEach(([value,label])=>select.add(new Option(label,value))); if (select.multiple) previous.forEach(v=>{const o=[...select.options].find(x=>x.value===v); if(o)o.selected=true;}); else if ([...select.options].some(o=>o.value===previous)) select.value=previous; }
function makeTable(headers, rows, empty = "მონაცემები არ არის") { const wrap = document.createElement("div"); wrap.className = "table-wrap"; if (!rows.length) { wrap.innerHTML = `<div class="table-empty">${empty}</div>`; return wrap; } const table = document.createElement("table"); table.className = "data-table"; const thead = table.createTHead().insertRow(); headers.forEach(h=>thead.insertCell().append(document.createTextNode(h))); const tbody = table.createTBody(); rows.forEach(values=>{ const tr=tbody.insertRow(); values.forEach(value=>{ const td=tr.insertCell(); if(value instanceof Node) td.append(value); else td.textContent=value == null ? "—" : String(value); }); }); wrap.append(table); return wrap; }
function button(label, action, cls = "link-button") { const el = document.createElement("button"); el.type="button"; el.className=cls; el.textContent=label; el.onclick=run(action); return el; }
function statusPill(status) { const span=document.createElement("span"); span.className=`status-pill status-${status}`; span.textContent=STATUS[status] || status || "—"; return span; }

function setScreen(id) {
  const allowed = session?.role === "admin" || session?.role === "founder";
  if (session?.role === "operator" && id !== "entry") id = "entry";
  if (session?.role === "founder" && id !== "analysis") id = "analysis";
  currentScreen = id;
  $all(".screen").forEach(section => section.hidden = section.id !== `screen-${id}`);
  $all(".nav-item").forEach(item => item.classList.toggle("active", item.dataset.screen === id));
  const [title,kicker] = TITLES[id] || TITLES.analysis; $("page-title").textContent=title; $("page-kicker").textContent=kicker;
  if (id === "analysis" && allowed) loadReport();
  if (id === "entry") { loadEntry(); loadMissing(); }
  if (id === "records") loadRecords();
  if (id === "import") loadImports();
  if (id === "corrections") loadCorrections();
  if (id === "manage") { loadUsers(); renderBranchList(); }
  if (id === "history") loadHistory();
}
function logout() { token=null; sessionStorage.removeItem("sales-token"); session=null; $("app-shell").hidden=true; $("login-screen").hidden=false; }

function setupBranches() {
  const entries = (session?.branches || []).map(b=>[b.id,b.name]);
  $all("select[data-branches]").forEach(select=>setOptions(select, entries, select.dataset.empty));
  const dailyBranch = $("daily-form")?.elements.branch_id; if (dailyBranch && !dailyBranch.value && entries[0]) dailyBranch.value=entries[0][0];
}
async function openSession() {
  session = await api("session");
  $("login-screen").hidden=true; $("app-shell").hidden=false;
  $all(".admin-only").forEach(el=>el.hidden=session.role !== "admin");
  $all('[data-screen="analysis"]').forEach(el=>el.hidden=session.role === "operator");
  $all('[data-screen="entry"]').forEach(el=>el.hidden=session.role === "founder");
  $all('[data-screen="records"]').forEach(el=>el.hidden=session.role !== "admin");
  $("today-label").textContent = dateLabel(session.today); const roleName={admin:"ადმინისტრატორი",founder:"დამფუძნებელი",operator:"ოპერატორი"}[session.role] || session.role; $("user-role").textContent=roleName; $("user-email").textContent=session.display_name || session.username || session.email || roleName; $("user-initial").textContent=(session.display_name || session.username || roleName).slice(0,1).toUpperCase();
  setupBranches();
  const report = $("report-form"); report.elements.end.value ||= session.today; report.elements.start.value ||= `${session.today.slice(0,8)}01`;
  const entry = $("daily-form"); entry.elements.day.max=session.today; entry.elements.day.value ||= session.today;
  $("entry-date-display").textContent = dateLabel(entry.elements.day.value);
  const first = ["admin","founder"].includes(session.role) ? "analysis" : "entry"; setScreen(first);
}

function reportQuery() { const form=$("report-form"); return new URLSearchParams({start:form.elements.start.value,end:form.elements.end.value,branches:[...form.elements.branches.selectedOptions].map(o=>o.value).join(",")}); }
async function loadReport() { if (!session || !["admin","founder"].includes(session.role)) return; try { currentReport=await api(`report?${reportQuery()}`); renderReport(currentReport); ensureInfoButtons(); } catch(error) { notify(error.message,true); } }
function kpi(label,value,meta,accent=false,helpKey="kpi"){ return `<article class="kpi${accent?" teal":""}" data-info-key="${helpKey}"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-meta">${meta || " "}</div></article>`; }
function renderReport(report) {
  const s=report.summary || {}; const prev=report.previous || {}; const annual=report.annual || {}; const forecast=report.forecast || {};
  const totalMeta = metricMeta(s.total,s.recorded) || `${s.recorded ?? 0} ჩანაწერი`;
  const averageMeta = metricMeta(s.average,s.observations) || `${s.observations ?? 0} გამოყენებული დღე`;
  $("kpi-grid").innerHTML = [kpi("პერიოდის ნავაჭრი",metricMoney(s.total,s.recorded),totalMeta,true,"total"),kpi("საშუალო დღიური",metricMoney(s.average,s.observations),averageMeta,false,"average"),kpi("დაფარვა",pctPlain(s.coverage),`${s.missing ?? 0} გამოტოვებული დღე`,false,"coverage"),kpi("წინა პერიოდთან",pct(prev.percent),prev.change == null ? "საბაზო მონაცემი არ არის" : `ცვლილება ${money(prev.change)}`,false,"comparison"),kpi("წინა წლის იმავე პერიოდთან",pct(annual.percent),annual.baseline ? `დაფარვა ${pctPlain(annual.baseline.coverage)}` : "შედარება მიუწვდომელია",false,"annual"),kpi("თვის პროგნოზი",metricMoney(forecast.total,s.recorded),forecast.total == null ? "ისტორია არასაკმარისია" : `${forecast.observations ?? 0} მედიანური დაკვირვება`,false,"forecast")].join("");
  renderTrend(report); renderInsights(report); renderBreakdown(currentBreakdown); renderSeasonality(report); renderAnomalies(report);
}
function renderTrend(report) { const data=(report.daily || []).slice(-31); const values=data.map(r=>numeric(r.total)||0); const rolling=data.map(r=>numeric(r.rolling7?.average)||0); const max=Math.max(...values,...rolling,1); const chart=$("trend-chart"); chart.replaceChildren(); data.forEach((row,i)=>{const col=document.createElement("div"); col.className="bar-col"; const pair=document.createElement("div"); pair.style.cssText="height:100%;display:flex;align-items:flex-end;gap:2px;width:100%;justify-content:center"; const bar=document.createElement("div"); bar.className="bar"; bar.style.height=`${Math.max(2,(values[i]/max)*100)}%`; const avg=document.createElement("div"); avg.className="bar rolling"; avg.style.height=`${Math.max(2,(rolling[i]/max)*100)}%`; pair.append(bar,avg); const label=document.createElement("div"); label.className="bar-label"; label.textContent=String(row.day).slice(5); col.append(pair,label); chart.append(col); }); $("chart-caption").textContent = data.length ? `${dateLabel(data[0].day)} — ${dateLabel(data.at(-1).day)}` : ""; }
function renderInsights(report) { const s=report.summary||{}; const rows=[]; if ((Number(s.recorded)||0)===0 && (Number(s.missing)||0)===0) rows.push(["amber","არჩეულ პერიოდში მოქმედი ჩანაწერი არ არის — ნაჩვენები „მონაცემი არ არის“ ნულოვან მნიშვნელობას არ ანაცვლებს."]); else if (numeric(s.coverage)!==null && numeric(s.coverage)<100) rows.push(["amber",`დაფარვა ${pctPlain(s.coverage)}-ია — ${s.missing||0} ფილიალ-დღე საჭიროებს შევსებას.`]); else rows.push(["teal","არჩეულ პერიოდში ყველა მოსალოდნელი ფილიალ-დღე დაფარულია."]); const anomalies=(report.rows||[]).filter(r=>r.anomaly!=null); if(anomalies.length) rows.push(["red",`${anomalies.length} უჩვეულო შედეგი აღმოჩნდა შესამოწმებლად.`]); const share=Object.entries(report.branches||{}).sort((a,b)=>(numeric(b[1].share)||0)-(numeric(a[1].share)||0))[0]; if(share && numeric(share[1].share)!==null) rows.push(["teal",`${branchName(share[0])} ქსელის ნავაჭრის ${pctPlain(share[1].share)}-ს ქმნის.`]); if(report.forecast?.total!=null) rows.push(["teal",`მიმდინარე თვის პროგნოზი ${money(report.forecast.total)}-ია.`]); else rows.push(["amber","სრული პროგნოზისთვის ისტორიული დაკვირვებები საკმარისი არ არის."]); $("insights").innerHTML=rows.map(([tone,text])=>`<div class="insight-row"><i class="insight-bullet ${tone==='amber'?'amber':tone==='red'?'red':''}"></i><span>${text}</span></div>`).join(""); }
function renderBreakdown(kind) { if(!currentReport)return; const report=currentReport; let headers=[],rows=[]; if(kind==="branches"){headers=["ფილიალი","ნავაჭრი","ქსელის წილი","საშუალო დღე","დაფარვა","ჩანაწერები"]; rows=Object.entries(report.branches||{}).sort((a,b)=>(numeric(b[1].summary?.total)||0)-(numeric(a[1].summary?.total)||0)).map(([id,v])=>[branchName(id),metricMoney(v.summary?.total,v.summary?.recorded),pctPlain(v.share),metricMoney(v.summary?.average,v.summary?.observations),pctPlain(v.summary?.coverage),v.summary?.recorded]);}else{const list=kind==="week"?report.periods?.week:kind==="month"?report.periods?.month:report.daily; headers=[kind==="daily"?"თარიღი":kind==="week"?"კვირა (ორშაბათი)":"თვე","ნავაჭრი","საშუალო დღე","დაფარვა","გამოტოვებული","7-დღიანი მოძრავი","28-დღიანი მოძრავი"]; rows=(list||[]).map(r=>[kind==="daily"?dateLabel(r.day):kind==="week"?dateLabel(r.day):`${String(r.day).slice(0,7)}`,metricMoney(r.total,r.recorded),metricMoney(r.average,r.observations),pctPlain(r.coverage),r.missing ?? "—",metricMoney(r.rolling7?.average,r.rolling7?.observations),metricMoney(r.rolling28?.average,r.rolling28?.observations)]);} $("breakdown-content").replaceChildren(makeTable(headers,rows)); }
function renderSeasonality(report){ const rows=[]; Object.entries(report.branches||{}).forEach(([id,v])=>{ const week=Object.entries(v.seasonality?.weekday||{}).slice(0,7); week.forEach(([key,item])=>rows.push([branchName(id),weekdays[Number(key)]||key,pctPlain(item.index),item.observations])); }); $("seasonality").innerHTML=rows.length?`<div class="mini-row header"><span>ფილიალი</span><span>დღე</span><span>ინდექსი / დაკვ.</span></div>`+rows.slice(0,30).map(r=>`<div class="mini-row"><span>${r[0]}</span><span>${r[1]}</span><span>${r[2]} · ${r[3]}</span></div>`).join(""):"<div class='empty-state'>საკმარისი ისტორია არ არის.</div>"; }
function renderAnomalies(report){ const rows=(report.rows||[]).filter(r=>r.anomaly!=null); $("anomaly-count").textContent=rows.length; $("anomalies").innerHTML=rows.length?`<div class="mini-row header"><span>ფილიალი</span><span>თარიღი</span><span>გადახრა</span></div>`+rows.slice(0,20).map(r=>`<div class="mini-row"><span>${branchName(r.branch_id)}</span><span>${dateLabel(r.day)}</span><span class="${numeric(r.anomaly)<0?'status-missing':''}">${pctPlain(r.anomaly)}</span></div>`).join(""):"<div class='empty-state'>უჩვეულო შედეგი არ აღმოჩნდა.</div>"; }

async function loadEntry(){ const form=$("daily-form"); if(!form.elements.branch_id.value || !form.elements.day.value)return; $("entry-date-display").textContent=dateLabel(form.elements.day.value); record=null; try { const data=await api(`day?branches=${encodeURIComponent(form.elements.branch_id.value)}&day=${form.elements.day.value}`); record=data.record; const status=$("entry-status"); status.replaceChildren(statusPill(data.status)); status.className="status-pill"; form.elements.amount.value=record?.amount ?? ""; form.elements.zero_confirmed.checked=record?.amount === "0"; form.elements.reason.value=""; $("entry-record-info").textContent=record?`ბოლო დადასტურებული ვერსია · v${record.version} · ${record.source === "excel" ? "Excel იმპორტი" : "ხელით შეყვანილი"}`:`ამ თარიღზე მოქმედი ჩანაწერი ჯერ არ არსებობს.`; const admin=session.role === "admin"; form.elements.reason.required=Boolean(admin && record); $("entry-submit").hidden=!(admin || !record || (record.active && record.source === "manual" && record.created_by === session.user_id && record.day === session.today)); $("entry-request").hidden=admin || !record?.active; $("entry-void").hidden=!admin || !record?.active; } catch(error){notify(error.message,true);} }
async function loadMissing(){ if(!session)return; try{ const data=await api("missing"); const limited=data.slice(0,20); $("missing-total").textContent=data.length; $("missing-badge").textContent=data.length; $("missing-badge").hidden=!data.length; $("missing-list").innerHTML=limited.length?`<div class="mini-row header"><span>ფილიალი</span><span>თარიღი</span><span></span></div>`+limited.map(r=>`<div class="mini-row"><span>${branchName(r.branch_id)}</span><span>${dateLabel(r.day)}</span><span></span></div>`).join(""):"<div class='empty-state'>გამოტოვებული დღეები არ არის.</div>";}catch(error){notify(error.message,true);} }
async function saveEntry(command){ const form=$("daily-form"); if(command !== "void" && !form.reportValidity())return; const payload={...formData(form),command,id:record?.id,version:record?.version||0}; if(command === "request" && !payload.reason) throw new Error("შესწორების მოთხოვნას მიზეზი სჭირდება"); await api("command",{body:payload}); notify(command === "request" ? "მოთხოვნა გაიგზავნა" : command === "void" ? "ჩანაწერი გაუქმდა" : "ჩანაწერი შენახულია"); await Promise.all([loadEntry(),loadMissing()]); }

async function loadCorrections(){ if(session?.role!=="admin")return; try{const rows=await api("corrections"); const pending=rows.filter(r=>r.status==="pending").length; $("correction-badge").textContent=pending; $("correction-badge").hidden=!pending; const values=rows.map(r=>[r.sale_id,dateLabel(r.requested_at),money(r.old_amount),money(r.new_amount),r.reason,statusPill(r.status),r.status==="pending"?reviewControls(r):r.review_comment||"—"]); $("corrections-content").replaceChildren(makeTable(["ჩანაწერი","თარიღი","ძველი თანხა","ახალი თანხა","მიზეზი","სტატუსი","განხილვა"],values,"მოთხოვნები ჯერ არ არის."));}catch(error){notify(error.message,true);} }
function reviewControls(row){ const box=document.createElement("div"); box.className="correction-controls"; const input=document.createElement("input"); input.placeholder="კომენტარი"; box.append(input,button("დამტკიცება",async()=>{await api("command",{body:{command:"review",id:row.id,decision:"approved",comment:input.value}}); await loadCorrections();},"primary"),button("უარყოფა",async()=>{await api("command",{body:{command:"review",id:row.id,decision:"rejected",comment:input.value}}); await loadCorrections();},"danger")); return box; }

async function loadImports(selectedId){ if(session?.role!=="admin")return; try{const batches=await api("imports"); setOptions($("batches"),batches.map(b=>[b.id,`${b.filename} · ${STATUS[b.status]||b.status}`]),"აირჩიე პარტია"); if(selectedId)$("batches").value=selectedId; batch=batches.find(b=>b.id===$("batches").value); lines=batch?await api(`imports?id=${batch.id}`):[]; $("import-counts").innerHTML=batch?Object.entries(batch.counts||{}).map(([key,value])=>`<div class="count-box"><strong>${value}</strong><span>${STATUS[key]||key}</span></div>`).join(""):"<div class='empty-state'>ატვირთე ფაილი, რომ პარტია შეიქმნას.</div>"; const mapping=$("mapping"); mapping.replaceChildren(); const unknown=new Map(lines.filter(l=>l.status==="unmapped").map(l=>[String(l.cell).match(/^[A-Z]+/)?.[0],l.title])); unknown.forEach((title,column)=>{const label=document.createElement("label");label.textContent=`${column} · ${title}`;const select=document.createElement("select");select.dataset.column=column;setOptions(select,(session.branches||[]).map(b=>[b.id,b.name]),"აირჩიე ფილიალი");label.append(select);mapping.append(label);}); $("publish").disabled=!batch||batch.status==="published"; $("remap").disabled=!batch||batch.status==="published"; renderImportPreview();}catch(error){notify(error.message,true);} }
function renderImportPreview(){const filter=$("line-filter").value; const selected=lines.filter(l=>!filter||l.status===filter); const rows=selected.slice(0,250).map(l=>[`${l.sheet} / ${l.cell}`,l.branch_id?branchName(l.branch_id):l.title,dateLabel(l.source_day),dateLabel(l.applied_day),l.amount||"—",statusPill(l.status),l.error||l.date_reason||"—"]); const wrap=makeTable(["ფურცელი / უჯრა","ფილიალი","წყაროს თარიღი","გამოყენებული","თანხა","სტატუსი","მიზეზი"],rows,"ამ ფილტრით სტრიქონი არ მოიძებნა."); $("preview").replaceChildren(wrap); if(selected.length>250){const more=document.createElement("p");more.className="filter-hint";more.textContent=`ნაჩვენებია 250 / ${selected.length} სტრიქონი`;$("preview").append(more);} }

async function loadHistory(id){ if(session?.role!=="admin")return; try{const rows=await api(`audit${id?`?id=${encodeURIComponent(id)}`:""}`); const values=rows.map(r=>[dateLabel(r.created_at),`${r.object_type} · ${r.object_id}`,r.action,r.actor,r.reason||"—",jsonCell(r.old_value),jsonCell(r.new_value)]); $("history-content").replaceChildren(makeTable(["დრო","ობიექტი","მოქმედება","ავტორი","მიზეზი","ძველი","ახალი"],values,"ისტორია ცარიელია."));}catch(error){notify(error.message,true);} }
function jsonCell(value){const pre=document.createElement("pre");pre.className="json-cell";pre.textContent=value?JSON.stringify(value,null,2):"—";return pre;}

$("signin").onsubmit=run(async()=>{const form=$("signin");const body=formData(form);if(setupToken){body.setupToken=setupToken;body.email=body.identifier;}token=(await api(setupToken?"setup":"login",{body})).token;setupToken=null;sessionStorage.setItem("sales-token",token);form.reset();await openSession();});
let setupToken=new URLSearchParams(location.hash.slice(1)).get("setup"); if(setupToken){history.replaceState(null,"",location.pathname+location.search);$("login-title").textContent="ადმინისტრატორის შექმნა";$("signin-submit").innerHTML="ანგარიშის შექმნა <span>↗</span>";$("signin").elements.password.minLength=6;$("signin").elements.password.autocomplete="new-password";}
$("logout").onclick=logout;
$all("[data-screen]").forEach(item=>item.onclick=run(()=>setScreen(item.dataset.screen)));
$all("[data-preset]").forEach(item=>item.onclick=()=>{const end=isoToday();$("report-form").elements.end.value=end;$("report-form").elements.start.value=dateMinus(end,Number(item.dataset.preset)-1);$all("[data-preset]").forEach(x=>x.classList.toggle("selected",x===item));loadReport();});
$("report-form").onsubmit=run(loadReport); $("analysis-refresh").onclick=run(loadReport); $all("[data-breakdown]").forEach(item=>item.onclick=()=>{currentBreakdown=item.dataset.breakdown;$all("[data-breakdown]").forEach(x=>x.classList.toggle("active",x===item));renderBreakdown(currentBreakdown);});
$all("[data-export]").forEach(el=>el.onclick=run(async()=>{if(!$("report-form").reportValidity())return;const params=reportQuery();params.set("format",el.dataset.export);const blob=await api(`export?${params}`,{binary:true});const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=`sales.${el.dataset.export}`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);notify(`${el.dataset.export.toUpperCase()} ფაილი მზადაა`); }));
$("daily-form").onsubmit=run(()=>saveEntry("save")); $("entry-request").onclick=run(()=>saveEntry("request")); $("entry-void").onclick=run(()=>{if(confirm("ჩანაწერი გაუქმდეს?"))return saveEntry("void");}); [$("daily-form").elements.branch_id,$("daily-form").elements.day].forEach(el=>el.onchange=run(loadEntry));
$("upload-form").onsubmit=run(async()=>{const form=$("upload-form"),file=form.elements.file.files[0];if(!file)return;const params=new URLSearchParams({filename:file.name,seed:form.elements.seed.checked?"1":"0"});const result=await api(`upload?${params}`,{body:file});await openSession();setScreen("import");await loadImports(result.id);notify("ფაილი აიტვირთა — გადაამოწმე წინასწარი გადახედვა");}); $("batches").onchange=run(()=>loadImports()); $("line-filter").onchange=renderImportPreview;
$("remap").onclick=run(async()=>{const mapping=Object.fromEntries([...$("mapping").querySelectorAll("select")].filter(s=>s.value).map(s=>[s.dataset.column,s.value]));await api("remap",{body:{id:batch.id,mapping}});await loadImports(batch.id);}); $("publish").onclick=run(async()=>{if(!batch||!confirm("მზად მყოფი ჩანაწერები გამოქვეყნდეს?"))return;const result=await api("command",{body:{command:"publish",id:batch.id,reasons}});await loadImports(result.id);notify("იმპორტი გამოქვეყნდა");});
$("branch-form").elements.id.onchange=()=>{const branch=session.branches.find(b=>b.id===$("branch-form").elements.id.value);const form=$("branch-form");form.elements.name.value=branch?.name||"";form.elements.excel_title.value=branch?.excel_title||"";form.elements.active.checked=branch?.active??true;};
$("branch-form").onsubmit=run(async()=>{const form=$("branch-form");const data=formData(form);if(data.id==="")delete data.id;await api("command",{body:{...data,command:"branch"}});notify("ფილიალი შენახულია");await openSession();setScreen("manage");});
$("user-form").onsubmit=run(async()=>{const form=$("user-form");const data=formData(form);data.branch_ids=[...form.elements.branch_ids.selectedOptions].map(option=>option.value);await api("command",{body:{...data,command:"user"}});form.reset();notify("მომხმარებელი შეიქმნა");await loadUsers();});
$("user-form").elements.role.onchange=()=>{$("user-branches-label").hidden=$("user-form").elements.role.value!=="operator";}; $("user-form").elements.role.onchange();
// Session bootstrap is invoked after the analysis overrides below are installed.
async function loadRecords(){ if(!session)return; try{const form=$("records-form"); const params=new URLSearchParams({start:form.elements.start.value||"",end:form.elements.end.value||"",branches:[...form.elements.branches.selectedOptions].map(o=>o.value).join(",")}); const rows=await api(`records?${params}`); const values=rows.map(r=>[branchName(r.branch_id),dateLabel(r.day),r.amount||"—",r.source === "excel" ? "Excel" : "ხელით",r.active ? "მოქმედი" : "გაუქმებული",`v${r.version}`]); $("records-content").replaceChildren(makeTable(["ფილიალი","თარიღი","თანხა","წყარო","სტატუსი","ვერსია"],values,"ჩანაწერები არ არის."));}catch(error){notify(error.message,true);} }
async function legacyLoadUsers(){ if(session?.role!=="admin")return; try{const users=await api("users"); $("user-list").innerHTML=users.length?`<div class="mini-row header"><span>სახელი / მომხმარებლის სახელი</span><span>როლი</span><span>ფილიალები</span></div>`+users.map(u=>`<div class="mini-row"><span>${u.display_name || "—"}<br><small>${u.username || u.email || "—"}</small></span><span>${({admin:"ადმინისტრატორი",founder:"დამფუძნებელი",operator:"ოპერატორი"}[u.role]||u.role)}</span><span>${(u.branches||[]).map(b=>b.name).join(", ")||"ყველა / არაა საჭირო"}</span></div>`).join(""):"<div class='empty-state'>მომხმარებლები არ არის.</div>";}catch(error){notify(error.message,true);} }
function legacyRenderBranchList(){ const list=$("branch-list"); if(!list || !session)return; list.innerHTML=session.branches?.length?`<div class="mini-row header"><span>ფილიალი</span><span>Excel სათაური</span><span>სტატუსი</span></div>`+session.branches.map(b=>`<div class="mini-row"><span>${b.name}</span><span>${b.excel_title||"—"}</span><span>${b.active?"აქტიური":"არააქტიური"}</span></div>`).join(""):"<div class='empty-state'>ფილიალები ჯერ არ შექმნილა.</div>"; }
async function exportRecords(format){const form=$("records-form");const params=new URLSearchParams({start:form.elements.start.value||"",end:form.elements.end.value||"",branches:[...form.elements.branches.selectedOptions].map(o=>o.value).join(","),format});const blob=await api(`records-export?${params}`,{binary:true});const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=`records.${format}`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);notify(`${format.toUpperCase()} ფაილი მზადაა`);}
$("records-form").onsubmit=run(loadRecords); $("records-refresh").onclick=run(loadRecords); $all("[data-record-export]").forEach(el=>el.onclick=run(()=>exportRecords(el.dataset.recordExport)));
const legacyLoadImports = loadImports;
const roleLabel = {admin:"ადმინისტრატორი",founder:"დამფუძნებელი",operator:"ოპერატორი"};
const analysisHelp = {
  filters:"პერიოდი განსაზღვრავს რომელი კალენდარული დღეები მოხვდება ანგარიშში. ცარიელი ფილიალების არჩევანი ნიშნავს მთელ ქსელს. ანგარიშში გამოიყენება მხოლოდ მოქმედი, ბოლო დადასტურებული ვერსია.\n\n0 ₾ არ არის სისტემის მიერ ჩასმული ნული: ეს ნიშნავს, რომ იმ ფილიალ-დღეზე დადასტურებული ჩანაწერი არსებობს და თანხა ნულად არის შეყვანილი. „მონაცემი არ არის“ ნიშნავს, რომ მოქმედი ჩანაწერი არ არსებობს.",
  kpi:"ძირითადი ბარათები იყენებს მხოლოდ მოქმედ, ბოლო დადასტურებულ ვერსიებს.\n\n• პერიოდის ნავაჭრი — არჩეულ დღეებში მოქმედი თანხების ჯამი.\n• საშუალო დღიური — ფილიალის ჯამი გაყოფილი თანხით შევსებულ სამუშაო დღეებზე; დადასტურებული 0 ₾ დღე საშუალოს დღეების რაოდენობაში მონაწილეობს. ქსელისთვის საშუალო ითვლება მხოლოდ სრულად დაფარული დღეების მიხედვით.\n• დაფარვა — ჩანაწერიანი მოსალოდნელი ფილიალ-დღეები გაყოფილი ყველა მოსალოდნელ ფილიალ-დღეზე.\n• შედარებები და პროგნოზი მიუწვდომელია, თუ შესაბამისი საბაზო ან ისტორიული მონაცემი საკმარისი არ არის.",
  total:"ეს არის არჩეულ პერიოდში მოქმედი თანხების ჯამი. გაუქმებული, იმპორტის შეცდომიანი და მოლოდინში მყოფი ჩანაწერები არ შედის. 0 ₾ გამოჩნდება მხოლოდ მაშინ, როცა დადასტურებული ნულოვანი ჩანაწერი არსებობს; ჩანაწერის არქონისას იწერება „მონაცემი არ არის“.",
  average:"ფილიალისთვის საშუალო არის ჯამი ÷ თანხით შევსებული სამუშაო დღეების რაოდენობა. დადასტურებული ნული ითვლება შევსებულ დღედ. ქსელისთვის გამოიყენება მხოლოდ სრულად დაფარული დღეების ქსელური ჯამები და ნაჩვენებია გამოყენებული დღეების რაოდენობა.",
  coverage:"დაფარვა არის ჩანაწერიანი მოსალოდნელი ფილიალ-დღეები ÷ ყველა მოსალოდნელი ფილიალ-დღეები × 100. მოსალოდნელი დღეები მოიცავს აქტიურ პერიოდს, გარდა ადმინისტრატორის მიერ არასამუშაოდ მონიშნული დღეებისა. დადასტურებული 0 ₾ სრულ ჩანაწერად ითვლება.",
  comparison:"მიმდინარე პერიოდი შედარებულია იმავე სიგრძის წინა პერიოდთან. თანხობრივი ცვლილება არის მიმდინარე − წინა; პროცენტული ცვლილება არის (მიმდინარე ÷ წინა − 1) × 100. ნულოვანი ან არმქონე საბაზო პერიოდისას პროცენტი მიუწვდომელია.",
  annual:"მიმდინარე პერიოდი შედარებულია წინა წლის იმავე კალენდარულ მონაკვეთთან. არასრული პერიოდი წინა წლის იმავე გასულ დღეებს იყენებს. ორივე მხარეს ახლავს დაფარვა.",
  forecast:"მიმდინარე თვის დადასტურებულ ჯამს ემატება დარჩენილი მოსალოდნელი სამუშაო დღეების შეფასება. შეფასება ეფუძნება იმავე ფილიალისა და კვირის დღის ბოლო რვა კვირის მედიანას და მოითხოვს მინიმუმ ექვს დაკვირვებას. გამოტოვებული გასული დღე ან არასაკმარისი ისტორია სრულ პროგნოზს მიუწვდომელს ხდის.",
  trend:"სვეტები აჩვენებს თითოეული კალენდარული დღის მოქმედ ჯამს. ღია სვეტი არის ბოლო 7 კალენდარული დღის მოქმედი თანხების ჯამი გაყოფილი ამ ფანჯარაში თანხით შევსებული სამუშაო დღეების რაოდენობაზე. თუ დღის მონაცემი არ არსებობს, სვეტი არ უნდა იქნეს წაკითხული როგორც ნული.",
  insight:"ეს ბლოკი აჯამებს მონაცემთა ხარისხს, დაფარვას, უჩვეულო შედეგებს, ქსელის წილსა და პროგნოზს. შეტყობინება „მონაცემი არ არის“ ნიშნავს არასაკმარის ან არმქონე წყაროს და არა ნულოვან ნავაჭრს.",
  breakdown:"დღეები, კვირები, თვეები და ფილიალები აჩვენებს იმავე მოქმედ მონაცემებს სხვადასხვა ჭრილში. კვირა იწყება ორშაბათს. არასრულ პერიოდს ახლავს დაფარვა და გამოტოვებული ფილიალ-დღეების რაოდენობა. 7-დღიანი და 28-დღიანი მოძრავი საშუალოები იყენებს მხოლოდ შესაბამის ფანჯარაში თანხით შევსებულ სამუშაო დღეებს.",
  seasonality:"კვირის დღის ინდექსი არის კონკრეტული კვირის დღის საშუალო ÷ იმავე ფილიალის საერთო დღიური საშუალო × 100. 100% ნიშნავს ფილიალის ჩვეულებრივ საშუალოს; 100%-ზე მეტი — საშუალოზე მაღალ შედეგს. ინდექსთან ნაჩვენებია დაკვირვებების რაოდენობა. თვის სეზონურობა ითვლის მხოლოდ სრულად დაფარულ წლებს.",
  anomalies:"უჩვეულო შედეგი მონიშნულია მაშინ, როცა დღიური თანხა იმავე ფილიალის წინა რვა კალენდარულ კვირაში იმავე კვირის დღის მედიანას მინიმუმ ±30%-ით სცდება და არსებობს სულ მცირე ექვსი დაკვირვება. გამოტოვებული დღე ანომალია არ არის — ეს მონაცემთა ხარისხის საკითხია."
};
function showAnalysisInfo(key){
  let modal=$("analysis-info-modal");
  if(!modal){ modal=document.createElement("div"); modal.id="analysis-info-modal"; modal.className="info-modal-backdrop"; modal.hidden=true; modal.innerHTML=`<div class="info-modal" role="dialog" aria-modal="true"><button class="info-close" type="button" aria-label="დახურვა">×</button><span class="eyebrow">განმარტება</span><h3></h3><p></p></div>`; document.body.append(modal); modal.addEventListener("click",event=>{if(event.target===modal)modal.hidden=true;}); modal.querySelector(".info-close").onclick=()=>modal.hidden=true;}
  modal.querySelector("h3").textContent={filters:"პერიოდისა და ნულოვანი მნიშვნელობების განმარტება",kpi:"ძირითადი მაჩვენებლები",total:"პერიოდის ნავაჭრი",average:"საშუალო დღიური",coverage:"დაფარვა",comparison:"წინა პერიოდთან ცვლილება",annual:"წინა წლის ცვლილება",forecast:"თვის პროგნოზი",trend:"ნავაჭრის დინამიკა",insight:"სწრაფი შეჯამება",breakdown:"ჩაშლილი მაჩვენებლები",seasonality:"სეზონურობა",anomalies:"უჩვეულო შედეგები"}[key] || "ანალიზის განმარტება";
  modal.querySelector("p").textContent=analysisHelp[key] || "ამ ბლოკის განმარტება ხელმისაწვდომი არ არის."; modal.hidden=false;
}
function ensureInfoButtons(){
  const add=(parent,key)=>{if(!parent||parent.querySelector(`.info-button[data-info="${key}"]`))return;const btn=document.createElement("button");btn.type="button";btn.className="info-button";btn.dataset.info=key;btn.textContent="i";btn.title="განმარტება";btn.onclick=()=>showAnalysisInfo(key);parent.append(btn);};
  const filterLabel=$("screen-analysis")?.querySelector(".filter-label"); add(filterLabel,"filters");
  $all("#screen-analysis .chart-card .card-heading").forEach(x=>add(x,"trend")); $all("#screen-analysis .insight-card .card-heading").forEach(x=>add(x,"insight")); $all("#screen-analysis .analysis-lower-grid article:nth-child(1) .card-heading").forEach(x=>add(x,"seasonality")); $all("#screen-analysis .analysis-lower-grid article:nth-child(2) .card-heading").forEach(x=>add(x,"anomalies")); add($("screen-analysis").querySelector(".section-heading"),"breakdown"); $all("#kpi-grid .kpi").forEach(x=>add(x,x.dataset.infoKey||"kpi"));
}
function adjustPresets(){const labels={"7":"კვირა","30":"კალენდარული თვე","90":"კვარტალი"};$all("[data-preset]").forEach(btn=>{if(btn.dataset.preset==="365")btn.remove();else btn.textContent=labels[btn.dataset.preset]||btn.textContent;});}
function prepareManagement(){
  const form=$("branch-form"); if(form){ const id=form.elements.id; const excel=form.elements.excel_title; id?.closest("label")?.remove(); excel?.closest("label")?.remove(); let reset=document.createElement("button"); reset.type="button"; reset.className="secondary"; reset.textContent="ახალი ფილიალი"; reset.onclick=()=>{form.dataset.editId="";form.reset();form.elements.active.checked=true;}; form.prepend(reset); }
  const intro=$("screen-manage")?.querySelector(".screen-intro p"); if(intro)intro.remove();
}
function renderBranchList(){ const list=$("branch-list"); if(!list||!session)return; list.replaceChildren(); if(!session.branches?.length){list.innerHTML="<div class='empty-state'>ფილიალები ჯერ არ შექმნილა.</div>";return;} const head=document.createElement("div");head.className="mini-row header";head.innerHTML="<span>ფილიალი</span><span>სტატუსი</span><span>მოქმედება</span>";list.append(head);session.branches.forEach(branch=>{const row=document.createElement("div");row.className="mini-row";row.innerHTML=`<span>${branch.name}</span><span>${branch.active?"აქტიური":"არააქტიური"}</span>`;const actions=document.createElement("span");actions.append(button("რედაქტირება",()=>{const form=$("branch-form");form.dataset.editId=branch.id;form.elements.name.value=branch.name;form.elements.active.checked=branch.active;form.scrollIntoView({behavior:"smooth",block:"start"});},"secondary"),button(branch.active?"გაუქმება":"გააქტიურება",async()=>{await api("command",{body:{command:"branch",id:branch.id,name:branch.name,active:!branch.active}});await openSession();setScreen("manage");},branch.active?"danger ghost":"primary"));row.append(actions);list.append(row);}); }
async function loadUsers(){ if(session?.role!=="admin")return; try{const users=await api("users");const list=$("user-list");list.replaceChildren();if(!users.length){list.innerHTML="<div class='empty-state'>მომხმარებლები არ არის.</div>";return;}const head=document.createElement("div");head.className="mini-row header";head.innerHTML="<span>სახელი / მომხმარებლის სახელი</span><span>როლი</span><span>მოქმედება</span>";list.append(head);users.forEach(user=>{const row=document.createElement("div");row.className="mini-row";row.innerHTML=`<span>${user.display_name||"—"}<br><small>${user.username||user.email||"—"}</small></span><span>${roleLabel[user.role]||user.role}${user.enabled?"":" · გაუქმებული"}</span>`;const actions=document.createElement("span");actions.append(button("რედაქტირება",()=>editUser(user),"secondary"),button(user.enabled?"გაუქმება":"გაუქმებული",async()=>{if(!user.enabled)return;if(!confirm("მომხმარებელი გაუქმდეს?"))return;await api("command",{body:{command:"user_disable",id:user.id}});await loadUsers();},user.enabled?"danger ghost":"secondary"));row.append(actions);list.append(row);});}catch(error){notify(error.message,true);} }
function editUser(user){const form=$("user-form");form.dataset.editId=user.id;form.elements.username.value=user.username||"";form.elements.username.required=Boolean(user.username);form.elements.display_name.value=user.display_name||"";form.elements.password.value="";form.elements.password.required=false;form.elements.password.placeholder="ცარიელი დატოვე უცვლელად";form.elements.role.value=user.role;form.elements.role.dispatchEvent(new Event("change"));const ids=new Set((user.branches||[]).map(b=>b.id));[...form.elements.branch_ids.options].forEach(o=>o.selected=ids.has(o.value));form.querySelector("button[type=submit]").textContent="მომხმარებლის შენახვა";form.scrollIntoView({behavior:"smooth",block:"start"});}
loadImports = async function(selectedId){await legacyLoadImports(selectedId);ensureBatchDeleteButton();}
function ensureBatchDeleteButton(){const actions=$("screen-import")?.querySelector(".import-actions");if(!actions)return;let btn=$("batch-delete");if(!btn){btn=document.createElement("button");btn.id="batch-delete";btn.type="button";btn.className="danger ghost";btn.textContent="პარტიის წაშლა";actions.append(btn);btn.onclick=run(async()=>{if(!batch||!confirm("ეს პარტია წაიშალოს? უკვე გამოქვეყნებული ნავაჭრი დარჩება."))return;await api("command",{body:{command:"batch_delete",id:batch.id}});batch=null;lines=[];await loadImports();notify("პარტია წაიშალა");});}btn.hidden=!batch;}
function resetUserForm(){const form=$("user-form");form.reset();delete form.dataset.editId;form.elements.username.required=true;form.elements.password.required=true;form.elements.password.placeholder="მინიმუმ 6 სიმბოლო";form.querySelector("button[type=submit]").textContent="მომხმარებლის შექმნა";form.elements.role.dispatchEvent(new Event("change"));}
function enhanceAnalysisCopy(){const hint=$("screen-analysis")?.querySelector(".filter-hint");if(hint)hint.innerHTML='ცარიელი არჩევანი აჩვენებს მთელ ქსელს. გამოიყენება მხოლოდ მოქმედი, ბოლო დადასტურებული ვერსია. <strong>0 ₾</strong> ნიშნავს დადასტურებულ ნულოვან ნავაჭრს; <strong>„მონაცემი არ არის“</strong> ნიშნავს, რომ მოქმედი ჩანაწერი არ არსებობს.';ensureInfoButtons();}
renderTrend = function(report){ const data=(report.daily || []).slice(-31); const values=data.map(r=>numeric(r.total)).filter(v=>v!==null); const rolling=data.map(r=>numeric(r.rolling7?.average)).filter(v=>v!==null); const max=Math.max(...values,...rolling,1); const chart=$("trend-chart"); chart.replaceChildren(); data.forEach(row=>{const col=document.createElement("div"); col.className="bar-col"; const pair=document.createElement("div"); pair.style.cssText="height:100%;display:flex;align-items:flex-end;gap:2px;width:100%;justify-content:center"; const total=numeric(row.total); const avg=numeric(row.rolling7?.average); const bar=document.createElement("div"); bar.className=`bar${total===null|| (total===0 && !(Number(row.recorded)||0)) ? " no-data" : ""}`; bar.style.height=total===null?"1px":`${Math.max(2,(total/max)*100)}%`; bar.title=total===null?"მონაცემი არ არის":total===0?"დადასტურებული ნული":"დღიური ნავაჭრი"; const avgBar=document.createElement("div"); avgBar.className=`bar rolling${avg===null?" no-data":""}`; avgBar.style.height=avg===null?"1px":`${Math.max(2,(avg/max)*100)}%`; avgBar.title=avg===null?"მონაცემი არ არის":"7-დღიანი მოძრავი საშუალო"; pair.append(bar,avgBar); const label=document.createElement("div"); label.className="bar-label"; label.textContent=String(row.day).slice(5); col.append(pair,label); chart.append(col); }); $("chart-caption").textContent=data.length?`${dateLabel(data[0].day)} — ${dateLabel(data.at(-1).day)}`:""; };
$("branch-form").onsubmit=run(async()=>{const form=$("branch-form");const data=formData(form);data.excel_title=data.name;await api("command",{body:{...data,command:"branch",id:form.dataset.editId||undefined}});notify("ფილიალი შენახულია");await openSession();setScreen("manage");});
$("user-form").onsubmit=run(async()=>{const form=$("user-form");const data=formData(form);data.branch_ids=[...form.elements.branch_ids.selectedOptions].map(option=>option.value);if(form.dataset.editId){data.id=form.dataset.editId;data.command="user_update";if(!data.password)delete data.password;}else data.command="user";await api("command",{body:data});notify(form.dataset.editId?"მომხმარებელი განახლდა":"მომხმარებელი შეიქმნა");resetUserForm();await loadUsers();});
$("user-form").elements.role.onchange=()=>{$("user-branches-label").hidden=$("user-form").elements.role.value!=="operator";};
adjustPresets();prepareManagement();enhanceAnalysisCopy();

// Analysis redesign: period controls, race-safe loading, branch table filters,
// line chart and weekday seasonality. These overrides keep the existing entry,
// import and administration flows intact while replacing the analysis-only UI.
let uiReportRequestVersion = 0;
let uiRecordsRequestVersion = 0;
let uiPeriodMode = "month";
const uiBranchTableState = {sortIndex:1,sortDirection:"desc",filters:[]};

function uiSetLoading(id,text="იტვირთება…"){
  const target=$(id); if(target) target.innerHTML=`<div class="loading-state" role="status"><span class="loading-spinner"></span>${text}</div>`;
}
function uiSetReportLoading(){
  uiSetLoading("kpi-grid"); uiSetLoading("trend-chart"); uiSetLoading("breakdown-content"); uiSetLoading("seasonality");
  const summary=$("seasonality-summary"); if(summary) summary.replaceChildren();
}
function uiPad(value){return String(value).padStart(2,"0");}
function uiDaysInMonth(year,month){return new Date(Number(year),Number(month),0).getDate();}
function uiSelectedBranchIds(){return [...($("report-branches")?.selectedOptions||[])].map(option=>option.value).filter(Boolean);}
function uiPopulateYears(){
  const select=$("period-year"); if(!select)return;
  const todayYear=Number(isoToday().slice(0,4));
  const years=(session?.years?.length?session.years:Array.from({length:6},(_,i)=>todayYear-5+i));
  const current=select.value || String(todayYear);
  select.replaceChildren(...years.map(year=>new Option(String(year),String(year))));
  select.value=years.includes(Number(current))?String(current):String(todayYear);
}
function uiUpdateMonthAvailability(){
  const year=Number($("period-year")?.value), currentYear=Number(isoToday().slice(0,4)), currentMonth=Number(isoToday().slice(5,7));
  const select=$("period-month"); if(!select)return;
  [...select.options].forEach(option=>{option.disabled=year===currentYear && Number(option.value)>currentMonth;});
  if(select.selectedOptions[0]?.disabled)select.value=String(currentMonth);
}
function uiApplyPeriod(mode=uiPeriodMode,{load=true}={}){
  uiPeriodMode=mode;
  const year=Number($("period-year")?.value||isoToday().slice(0,4));
  const month=Number($("period-month")?.value||isoToday().slice(5,7));
  const quarter=Number($("period-quarter")?.value||Math.floor((month-1)/3)+1);
  const today=isoToday();
  let start,end;
  if(mode==="year"){
    start=`${year}-01-01`; end=year===Number(today.slice(0,4))?today:`${year}-12-31`;
  }else if(mode==="quarter"){
    const firstMonth=(quarter-1)*3+1;
    start=`${year}-${uiPad(firstMonth)}-01`;
    const endMonth=firstMonth+2;
    end=`${year}-${uiPad(endMonth)}-${uiPad(uiDaysInMonth(year,endMonth))}`;
    if(end>today)end=today;
  }else{
    start=`${year}-${uiPad(month)}-01`; end=`${year}-${uiPad(month)}-${uiPad(uiDaysInMonth(year,month))}`;
    if(end>today)end=today;
  }
  const form=$("report-form"); if(form){form.elements.start.value=start;form.elements.end.value=end;}
  $("period-month-wrap")?.toggleAttribute("hidden",mode!=="month");
  $("period-quarter-wrap")?.toggleAttribute("hidden",mode!=="quarter");
  $all("[data-period-mode]").forEach(button=>button.classList.toggle("selected",button.dataset.periodMode===mode));
  uiUpdateMonthAvailability();
  if(load)loadReport();
}
function uiSyncPeriodFromDates(){
  const form=$("report-form"); if(!form?.elements.start.value||!form.elements.end.value)return;
  const start=form.elements.start.value,end=form.elements.end.value;
  const year=Number(start.slice(0,4)),month=Number(start.slice(5,7));
  if($("period-year"))$("period-year").value=String(year);
  if($("period-month"))$("period-month").value=String(month);
  if($("period-quarter"))$("period-quarter").value=String(Math.floor((month-1)/3)+1);
  const monthEnd=`${year}-${uiPad(month)}-${uiPad(uiDaysInMonth(year,month))}`;
  const quarterStartMonth=Math.floor((month-1)/3)*3+1;
  const quarterEndMonth=quarterStartMonth+2;
  const quarterEnd=`${year}-${uiPad(quarterEndMonth)}-${uiPad(uiDaysInMonth(year,quarterEndMonth))}`;
  if(start===`${year}-01-01` && (end===isoToday()||end===`${year}-12-31`))uiPeriodMode="year";
  else if(start===`${year}-${uiPad(quarterStartMonth)}-01` && (end===isoToday()||end===quarterEnd))uiPeriodMode="quarter";
  else if(start===`${year}-${uiPad(month)}-01` && (end===isoToday()||end===monthEnd))uiPeriodMode="month";
  $all("[data-period-mode]").forEach(button=>button.classList.toggle("selected",button.dataset.periodMode===uiPeriodMode));
  $("period-month-wrap")?.toggleAttribute("hidden",uiPeriodMode!=="month");
  $("period-quarter-wrap")?.toggleAttribute("hidden",uiPeriodMode!=="quarter");
  uiUpdateMonthAvailability();
}
function uiUpdateSelectAllLabel(){
  const select=$("report-branches"),button=$("report-select-all"); if(!select||!button)return;
  const all=[...select.options].length>0 && [...select.options].every(option=>option.selected);
  button.textContent=all?"ყველას მონიშვნის მოხსნა":"ყველას მონიშვნა";
}
function uiInitAnalysisControls(){
  uiPopulateYears();
  const today=isoToday(),year=Number(today.slice(0,4)),month=Number(today.slice(5,7));
  $("period-year").value=String(year); $("period-month").value=String(month); $("period-quarter").value=String(Math.floor((month-1)/3)+1);
  uiApplyPeriod("month",{load:false});
  const reportBranches=$("report-branches"); if(reportBranches){[...reportBranches.options].forEach(option=>option.selected=true);uiUpdateSelectAllLabel();}
  const records=$("records-form"); if(records){records.elements.start.value=`${today.slice(0,8)}01`;records.elements.end.value=today;}
}

openSession = async function(){
  session=await api("session"); $("login-screen").hidden=true;$("app-shell").hidden=false;
  $all(".admin-only").forEach(el=>el.hidden=session.role!=="admin");
  $all('[data-screen="analysis"]').forEach(el=>el.hidden=session.role==="operator");
  $all('[data-screen="entry"]').forEach(el=>el.hidden=session.role==="founder");
  $all('[data-screen="records"]').forEach(el=>el.hidden=session.role!=="admin");
  $("today-label").textContent=dateLabel(session.today);
  const roleName={admin:"ადმინისტრატორი",founder:"დამფუძნებელი",operator:"ოპერატორი"}[session.role]||session.role;
  $("user-role").textContent=roleName;$("user-email").textContent=session.display_name||session.username||session.email||roleName;$("user-initial").textContent=(session.display_name||session.username||roleName).slice(0,1).toUpperCase();
  setupBranches();
  const entry=$("daily-form"); if(entry){entry.elements.day.max=session.today;entry.elements.day.value ||= session.today;$("entry-date-display").textContent=dateLabel(entry.elements.day.value);}
  uiInitAnalysisControls();
  const first=["admin","founder"].includes(session.role)?"analysis":"entry";setScreen(first);
};

loadReport = async function(){
  if(!session||!["admin","founder"].includes(session.role))return;
  const version=++uiReportRequestVersion; notify(""); uiSetReportLoading();
  try{const report=await api(`report?${reportQuery()}`);if(version!==uiReportRequestVersion)return;currentReport=report;renderReport(report);ensureInfoButtons();}
  catch(error){if(version===uiReportRequestVersion){uiSetLoading("kpi-grid","ანგარიში ვერ ჩაიტვირთა");notify(error.message,true);}}
};

function uiChartRows(report){
  if(uiPeriodMode==="year")return report.periods?.month||[];
  if(uiPeriodMode==="quarter")return report.periods?.week||[];
  return report.daily||[];
}
renderTrend = function(report){
  const rows=uiChartRows(report),known=rows.filter(row=>numeric(row.total)!==null),chart=$("trend-chart"); chart.replaceChildren();
  if(!known.length){chart.innerHTML='<div class="empty-state">მონაცემი არ არის</div>';$("chart-caption").textContent="";return;}
  const width=1000,height=300,padX=36,padY=28,base=height-padY;
  const max=Math.max(...known.map(row=>numeric(row.total)||0),1);
  const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.setAttribute("viewBox",`0 0 ${width} ${height}`);svg.setAttribute("role","img");svg.setAttribute("aria-label","ნავაჭრის დინამიკა");
  const grid=document.createElementNS(svg.namespaceURI,"path");grid.setAttribute("d",`M${padX} ${base}H${width-padX}`);grid.setAttribute("stroke","#dfe8e9");grid.setAttribute("fill","none");svg.append(grid);
  const points=known.map((row,index)=>{const x=known.length===1?width/2:padX+index*(width-padX*2)/(known.length-1);const y=base-(numeric(row.total)||0)/max*(height-padY*2);return {x,y,row};});
  const line=document.createElementNS(svg.namespaceURI,"path");line.setAttribute("d",points.map((point,index)=>`${index?"L":"M"}${point.x} ${point.y}`).join(" "));line.setAttribute("fill","none");line.setAttribute("stroke","#0f766e");line.setAttribute("stroke-width","5");line.setAttribute("stroke-linecap","round");line.setAttribute("stroke-linejoin","round");svg.append(line);
  points.forEach(point=>{const circle=document.createElementNS(svg.namespaceURI,"circle");circle.setAttribute("cx",point.x);circle.setAttribute("cy",point.y);circle.setAttribute("r","6");circle.setAttribute("fill","#fff");circle.setAttribute("stroke","#0f766e");circle.setAttribute("stroke-width","4");const title=document.createElementNS(svg.namespaceURI,"title");title.textContent=`${dateLabel(point.row.day)} — ${money(point.row.total)}`;circle.append(title);svg.append(circle);});
  const labels=known.filter((_,index)=>known.length<=8||index===0||index===known.length-1||index%Math.ceil(known.length/6)===0);labels.forEach(row=>{const index=known.indexOf(row),text=document.createElementNS(svg.namespaceURI,"text");text.setAttribute("x",known.length===1?width/2:padX+index*(width-padX*2)/(known.length-1));text.setAttribute("y",height-5);text.setAttribute("text-anchor","middle");text.setAttribute("class","chart-svg-label");text.textContent=uiPeriodMode==="year"?String(row.day).slice(0,7):dateLabel(row.day).slice(0,5);svg.append(text);});
  chart.append(svg);$("chart-caption").textContent=rows.length?`${dateLabel(rows[0].day)} — ${dateLabel(rows.at(-1).day)}`:"";
  $("screen-analysis")?.querySelector(".chart-legend span:nth-child(2)")?.remove();
};

renderInsights = function(){};
renderAnomalies = function(){};
renderBreakdown = function(){
  if(!currentReport)return;
  const entries=Object.entries(currentReport.branches||{}).map(([id,value])=>({id,name:branchName(id),total:numeric(value.summary?.total),share:numeric(value.share),average:numeric(value.summary?.average),coverage:numeric(value.summary?.coverage),recorded:Number(value.summary?.recorded)||0}));
  const headers=["ფილიალი","ნავაჭრი","ქსელის წილი","საშუალო დღიური","დაფარვა"];
  const values=row=>[row.name,row.total===null?"მონაცემი არ არის":money(row.total),row.share===null?"მონაცემი არ არის":pctPlain(row.share),row.average===null?"მონაცემი არ არის":money(row.average),row.coverage===null?"მონაცემი არ არის":pctPlain(row.coverage)];
  const sorted=entries.filter(row=>headers.every((_,index)=>{const filter=uiBranchTableState.filters[index]||"";return !filter||String(values(row)[index]).toLowerCase().includes(filter.toLowerCase());})).sort((a,b)=>{const av=[a.name,a.total,a.share,a.average,a.coverage][uiBranchTableState.sortIndex],bv=[b.name,b.total,b.share,b.average,b.coverage][uiBranchTableState.sortIndex];const result=typeof av==="string"?av.localeCompare(String(bv),"ka"):((av??-Infinity)-(bv??-Infinity));return uiBranchTableState.sortDirection==="asc"?result:-result;});
  const wrap=document.createElement("div");wrap.className="branch-breakdown-wrap";
  const toolbar=document.createElement("div");toolbar.className="branch-table-toolbar";const note=document.createElement("span");note.className="filter-hint";note.textContent="ფილტრი და დალაგება მუშაობს თითოეულ სვეტზე.";const actions=document.createElement("span");actions.className="table-export-actions";[["CSV","csv","filtered"],["Excel","xlsx","filtered"],["სრული CSV","csv","full"],["სრული Excel","xlsx","full"]].forEach(([label,format,scope])=>{const el=document.createElement("button");el.type="button";el.className=scope==="full"?"secondary":"primary";el.textContent=`↓ ${label}`;el.onclick=()=>uiExportBranchTable(format,scope,entries,sorted);actions.append(el);});toolbar.append(note,actions);wrap.append(toolbar);
  const table=document.createElement("table");table.className="data-table branch-breakdown-table";const thead=table.createTHead();const head=thead.insertRow();headers.forEach((header,index)=>{const cell=head.insertCell();const sort=document.createElement("button");sort.type="button";sort.className="table-sort";sort.textContent=header;sort.title="დალაგება";sort.onclick=()=>{if(uiBranchTableState.sortIndex===index)uiBranchTableState.sortDirection=uiBranchTableState.sortDirection==="asc"?"desc":"asc";else{uiBranchTableState.sortIndex=index;uiBranchTableState.sortDirection=index===0?"asc":"desc";}renderBreakdown("branches");};cell.append(sort);const input=document.createElement("input");input.className="column-filter";input.placeholder="ფილტრი";input.value=uiBranchTableState.filters[index]||"";input.type=index===0?"search":"text";input.oninput=()=>{uiBranchTableState.filters[index]=input.value;renderBreakdown("branches");};cell.append(input);});const body=table.createTBody();sorted.forEach(row=>{const tr=body.insertRow();values(row).forEach(value=>tr.insertCell().textContent=value);});wrap.append(table);$("breakdown-content").replaceChildren(wrap);
};

function uiSeasonalityMetrics(report){
  const branchMap=new Map();
  (report.rows||[]).forEach(row=>{const amount=numeric(row.amount);if(amount===null||amount===0)return;const weekdayIndex=(new Date(`${row.day}T12:00:00`).getDay()+6)%7;const item=branchMap.get(row.branch_id)||Array.from({length:7},()=>[]);item[weekdayIndex].push(amount);branchMap.set(row.branch_id,item);});
  const rows=[];const weekdayValues=Array.from({length:7},()=>[]);
  branchMap.forEach((days,id)=>{const averages=days.map(values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null);averages.forEach((value,index)=>{if(value!==null)weekdayValues[index].push(value);});const max=Math.max(...averages.filter(value=>value!==null),-Infinity);const winners=averages.map((value,index)=>value!==null&&Math.abs(value-max)<0.000001?index:null).filter(index=>index!==null);rows.push({id,winners,average:max,total:winners.reduce((sum,index)=>sum+days[index].reduce((a,b)=>a+b,0),0),observations:winners.reduce((sum,index)=>sum+days[index].length,0)});});
  const overall=weekdayValues.map(values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null);const overallMax=Math.max(...overall.filter(value=>value!==null),-Infinity);const overallWinners=overall.map((value,index)=>value!==null&&Math.abs(value-overallMax)<0.000001?index:null).filter(index=>index!==null);return {rows:rows.sort((a,b)=>branchName(a.id).localeCompare(branchName(b.id),"ka")),overallWinners};
}
renderSeasonality = function(report){const {rows,overallWinners}=uiSeasonalityMetrics(report);const summary=$("seasonality-summary");if(summary)summary.innerHTML=overallWinners.length?`<strong>ყველაზე მაღალნავაჭრიანი დღე:</strong> ${overallWinners.map(index=>weekdays[index]).join(", ")}`:"მონაცემი არ არის";const target=$("seasonality");if(!target)return;if(!rows.length){target.innerHTML='<div class="empty-state">მონაცემი არ არის</div>';return;}target.innerHTML='<div class="mini-row header"><span>ფილიალი</span><span>ყველაზე მაღალი დღე</span><span>საშუალო / ჯამი / დაკვ.</span></div>'+rows.map(row=>`<div class="mini-row"><span>${branchName(row.id)}</span><span>${row.winners.map(index=>weekdays[index]).join(", ")}</span><span>${money(row.average)} · ${money(row.total)} · ${row.observations}</span></div>`).join("");};

renderReport = function(report){
  const summary=report.summary||{},previous=report.previous||{},annual=report.annual||{};
  $("kpi-grid").innerHTML=[kpi("პერიოდის ნავაჭრი",metricMoney(summary.total,summary.recorded),`${summary.recorded||0} მოქმედი ჩანაწერი`,true,"total"),kpi("საშუალო დღიური",metricMoney(summary.average,summary.observations),`${summary.observations||0} გამოყენებული დღე`,false,"average"),kpi("წინა პერიოდთან",pct(previous.percent),previous.change==null?"საბაზო მონაცემი არ არის":`ცვლილება ${money(previous.change)}`,false,"comparison"),kpi("წინა წლის იმავე პერიოდთან",pct(annual.percent),annual.baseline?.total==null?"შედარება მიუწვდომელია":`მონაცემი ${money(annual.baseline.total)}`,false,"annual")].join("");
  renderTrend(report);renderBreakdown("branches");renderSeasonality(report);ensureInfoButtons();
};

function uiExportBranchTable(format,scope,allRows,filteredRows){
  const rows=scope==="full"?allRows:filteredRows;const headers=["ფილიალი","ნავაჭრი","ქსელის წილი","საშუალო დღიური","დაფარვა"];const body=rows.map(row=>[row.name,row.total===null?"მონაცემი არ არის":money(row.total),row.share===null?"მონაცემი არ არის":pctPlain(row.share),row.average===null?"მონაცემი არ არის":money(row.average),row.coverage===null?"მონაცემი არ არის":pctPlain(row.coverage)]);let content;
  if(format==="csv")content="\uFEFF"+[headers,...body].map(row=>row.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(",")).join("\r\n");
  else content='<html><meta charset="utf-8"><table><tr>'+headers.map(header=>`<th>${header}</th>`).join("")+"</tr>"+body.map(row=>`<tr>${row.map(value=>`<td>${value}</td>`).join("")}</tr>`).join("")+"</table></html>";
  const blob=new Blob([content],{type:format==="csv"?"text/csv;charset=utf-8":"application/vnd.ms-excel"});const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=`ფილიალების-ანალიზი.${format==="csv"?"csv":"xls"}`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);notify(`${format.toUpperCase()} ფაილი მზადაა`);
}

loadRecords = async function(){
  if(!session)return;const version=++uiRecordsRequestVersion;notify("");uiSetLoading("records-content");
  try{const form=$("records-form"),params=new URLSearchParams({start:form.elements.start.value||"",end:form.elements.end.value||"",branches:[...form.elements.branches.selectedOptions].map(option=>option.value).join(",")});const rows=await api(`records?${params}`);if(version!==uiRecordsRequestVersion)return;const values=rows.map(row=>[branchName(row.branch_id),dateLabel(row.day),numeric(row.amount)===0?"მონაცემი არ არის":money(row.amount),row.source==="excel"?"Excel":"ხელით",row.active?"მოქმედი":"გაუქმებული",`v${row.version}`]);$("records-content").replaceChildren(makeTable(["ფილიალი","თარიღი","თანხა","წყარო","მოქმედი","ვერსია"],values,"ჩანაწერები არ არის."));}
  catch(error){if(version===uiRecordsRequestVersion){uiSetLoading("records-content","ჩანაწერების ჩატვირთვა ვერ მოხერხდა");notify(error.message,true);}}
};

exportRecords = async function(format,scope="filtered"){const form=$("records-form"),params=new URLSearchParams({format});if(scope!=="full"){params.set("start",form.elements.start.value||"");params.set("end",form.elements.end.value||"");params.set("branches",[...form.elements.branches.selectedOptions].map(option=>option.value).join(","));}const blob=await api(`records-export?${params}`,{binary:true});const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=`records-${scope}.${format}`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);notify(`${format.toUpperCase()} ფაილი მზადაა`);};

Object.assign(analysisHelp,{filters:"აირჩიე წლისა და თვის/კვარტლის სწრაფი პერიოდი ან მიუთითე ხელით დაწყებისა და დასრულების თარიღები. ცარიელი ფილიალების არჩევანი ნიშნავს მთელ ქსელს.",total:"არჩეული პერიოდის მოქმედი, ნულზე მეტი თანხების ჯამი. 0 მონაცემად არ ითვლება და ანგარიშში არ მონაწილეობს.",average:"არჩეული ფილიალების საშუალო დღიური ნავაჭრი. საშუალოს გამყოფში შედის მხოლოდ ნულზე მეტი თანხით შევსებული დღეები.",coverage:"დაფარვა ითვლის მხოლოდ ნულზე მეტი თანხით არსებულ ჩანაწერიან ფილიალ-დღეებს მოსალოდნელ ფილიალ-დღეებთან მიმართებით. 0 და ცარიელი დღე დაფარვაში არ ითვლება.",comparison:"მიმდინარე პერიოდი შედარებულია იმავე რაოდენობის წინა კალენდარულ დღეებთან. მაგალითად, სრული აგვისტო ივლისს ედრება.",annual:"არჩეული პერიოდი შედარებულია წინა წლის ზუსტად იმავე კალენდარულ მონაკვეთთან.",trend:"ხაზოვანი მრუდე აჩვენებს არჩეული ფილიალების გაერთიანებულ ნავაჭრს. თვე იშლება დღეებად, კვარტალი კვირებად, წელი თვეებად. მონაცემის არქონისას ხაზი შემდეგ ცნობილ წერტილს უერთდება და ნულად არ ითვლება.",breakdown:"ფილიალების ჭრილში ჩანს ფილიალი, ნავაჭრი, მთელ ქსელში წილი, საშუალო დღიური ნავაჭრი და დაფარვა. სვეტების ფილტრები და დალაგება დამოუკიდებლად მუშაობს.",seasonality:"თითოეული ფილიალისთვის ითვლება კვირის დღეების საშუალო და ჯამური ნავაჭრი; 0 და მონაცემის არქონა გამოირიცხება. ზედა საერთო მაჩვენებელი ყველა ფილიალის საშუალოებს თანაბარი წონით ადარებს. თანაბარი მაქსიმუმები ყველა ერთად გამოჩნდება."});
showAnalysisInfo = function(key){let modal=$("analysis-info-modal");if(!modal){modal=document.createElement("div");modal.id="analysis-info-modal";modal.className="info-modal-backdrop";modal.hidden=true;modal.innerHTML='<div class="info-modal" role="dialog" aria-modal="true"><button class="info-close" type="button" aria-label="დახურვა">×</button><span class="eyebrow">განმარტება</span><h3></h3><p></p></div>';document.body.append(modal);modal.addEventListener("click",event=>{if(event.target===modal)modal.hidden=true;});modal.querySelector(".info-close").onclick=()=>modal.hidden=true;}const titles={filters:"პერიოდის ფილტრი",total:"პერიოდის ნავაჭრი",average:"საშუალო დღიური",comparison:"წინა პერიოდთან",annual:"წინა წლის შედარება",trend:"ნავაჭრის დინამიკა",breakdown:"ფილიალების ჭრილი",seasonality:"სეზონურობა",coverage:"დაფარვა"};modal.querySelector("h3").textContent=titles[key]||"ანალიზის განმარტება";modal.querySelector("p").textContent=analysisHelp[key]||"ამ ბლოკის განმარტება ხელმისაწვდომი არ არის.";modal.hidden=false;};
enhanceAnalysisCopy = function(){const hint=$("screen-analysis")?.querySelector(".filter-hint");if(hint)hint.textContent="აირჩიე წელი და თვე/კვარტალი ან მიუთითე თარიღები ხელით. ცარიელი ფილიალების არჩევანი ნიშნავს მთელ ქსელს.";ensureInfoButtons();};

$("report-select-all")?.addEventListener("click",()=>{const select=$("report-branches");if(!select)return;const allSelected=[...select.options].every(option=>option.selected);[...select.options].forEach(option=>option.selected=!allSelected);uiUpdateSelectAllLabel();});
$("report-branches")?.addEventListener("change",uiUpdateSelectAllLabel);
$all("[data-period-mode]").forEach(button=>button.addEventListener("click",()=>uiApplyPeriod(button.dataset.periodMode)));
$("period-year")?.addEventListener("change",()=>{uiUpdateMonthAvailability();uiApplyPeriod(uiPeriodMode);});
$("period-month")?.addEventListener("change",()=>uiApplyPeriod("month"));
$("period-quarter")?.addEventListener("change",()=>uiApplyPeriod("quarter"));
$("report-form")?.addEventListener("change",event=>{if(event.target.name==="start"||event.target.name==="end")uiSyncPeriodFromDates();});
if($("report-form"))$("report-form").onsubmit=run(loadReport);
if($("records-form"))$("records-form").onsubmit=run(loadRecords);
$all("[data-record-export]").forEach(button=>button.onclick=run(()=>exportRecords(button.dataset.recordExport,button.dataset.recordScope||"filtered")));
currentBreakdown="branches";
enhanceAnalysisCopy();
if(token)run(openSession)();

