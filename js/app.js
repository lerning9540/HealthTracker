const TH_MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

// ข้อมูลตัวอย่าง (mockup)

let records = [];

const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2,'0');
const range = (a,b) => Array.from({length:b-a+1}, (_,i) => a+i);
const opt = (v,t) => `<option value="${v}">${t}</option>`;
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate = iso => { const [y,m,d] = iso.split('-').map(Number); return `${d} ${TH_MONTHS[m-1]} ${y+543}`; };

// เร่งด่วน: ความดัน ≥180/≥110 หรือน้ำตาล ≥200 ต้องส่งพบแพทย์ทันที
// สงสัยป่วย: ความดัน 140–179 หรือ 90–109, น้ำตาล 126–199 เข้าติดตาม (BP Home 7 วัน)
function statusOf(r){
  if(r.sbp>=180 || r.dbp>=110 || r.fbs>=200) return 'refer';
  if((r.sbp>=140 && r.sbp<=179) || (r.dbp>=90 && r.dbp<=109) || (r.fbs>=126 && r.fbs<200)) return 'recheck';
  return 'normal';
}
function typeOf(r){
  const bp = r.sbp>=140 || r.dbp>=90;
  const sg = r.fbs>=126;
  if(bp && sg) return 'ความดัน/เบาหวาน';
  if(bp) return 'ความดันโลหิต';
  if(sg) return 'เบาหวาน';
  return '-';
}
const BADGE = { normal:['b-ok','ผลปกติ'], recheck:['b-warn','รอติดตามซ้ำ'], refer:['b-bad','รอพบแพทย์'] };

// ---- แจ้งเตือนทางอีเมล ----
const ALERT_KEY = 'alert_settings_v1';
const ALERT_LOG_KEY = 'alert_log_v1';
const ALERT_SUBJECT_DEFAULT = '[คัดกรองสุขภาพ] มีผู้รับการคัดกรองที่ต้องติดตาม';

function getAlertSettings(){
  const base = { email:'', subject: ALERT_SUBJECT_DEFAULT, url:'', token:'' };
  try{ return Object.assign(base, JSON.parse(localStorage.getItem(ALERT_KEY) || '{}')); }
  catch(e){ return base; }
}
function saveAlertSettings(s){
  try{ localStorage.setItem(ALERT_KEY, JSON.stringify(s)); return true; }
  catch(e){ return false; }
}
function isValidEmail(s){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }

// สีส้ม = รอติดตามซ้ำ (recheck) สีแดง = รอพบแพทย์ (refer)
function needsAlert(r){ return statusOf(r) !== 'normal'; }

function buildAlertMessage(r, st){
  const s = getAlertSettings();
  const label = st === 'refer' ? 'รอพบแพทย์ (สีแดง)' : 'รอติดตามซ้ำ (สีส้ม)';
  const lines = [
    'มีผู้รับการคัดกรองที่ต้องติดตาม',
    '',
    'รหัส: ' + (r.code || '-'),
    'สถานะ: ' + label,
    'วันที่คัดกรอง: ' + (r.date ? fmtDate(r.date) : '-'),
    '',
    'กรุณาเข้าระบบเพื่อดูรายละเอียด'
  ];
  return { to: s.email, subject: s.subject, body: lines.join('\n'), recordId: r.id, status: st };
}

function readAlertLog(){
  try{ return JSON.parse(localStorage.getItem(ALERT_LOG_KEY) || '[]'); }
  catch(e){ return []; }
}
function appendAlertLog(entry){
  const list = readAlertLog();
  list.push(entry);
  try{ localStorage.setItem(ALERT_LOG_KEY, JSON.stringify(list.slice(-200))); }catch(e){}
}

async function sendAlert(msg){
  const s = getAlertSettings();
  if(!isValidEmail(msg.to)) return { ok:false, error:'ยังไม่ได้ตั้งอีเมลแจ้งเตือน' };
  if(!s.url) return { ok:false, error:'ยังไม่ได้ตั้ง URL ของ Apps Script' };
  let ok = false, error = '';
  try{
    // ใช้ text/plain และ no-cors เพื่อหลีกเลี่ยงการตรวจ CORS ล่วงหน้า (ผลตอบกลับอ่านไม่ได้ จึงถือว่าส่งแล้วถ้าไม่มี error)
    await fetch(s.url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ token: s.token, to: msg.to, subject: msg.subject, body: msg.body })
    });
    ok = true;
  }catch(e){ error = 'เชื่อมต่อ Apps Script ไม่ได้'; }
  appendAlertLog({ at: new Date().toISOString(), recordId: msg.recordId || '-', status: msg.status || '-', to: msg.to, ok, error });
  return { ok, error };
}

// ส่งเมลครั้งเดียวต่อรายการ และข้ามถ้าเคยส่งสำเร็จแล้ว
async function maybeAlert(r){
  if(!r || !needsAlert(r)) return;
  if(readAlertLog().some(e => e.recordId === r.id && e.ok)) return;
  const res = await sendAlert(buildAlertMessage(r, statusOf(r)));
  if(!res.ok) toast('ส่งเมลแจ้งเตือนไม่สำเร็จ: ' + res.error);
}

// ลองส่งใหม่รายการที่ส่งไม่สำเร็จก่อนหน้านี้
function retryPendingAlerts(){
  const ids = [...new Set(readAlertLog().filter(e => !e.ok && e.recordId !== 'TEST').map(e => e.recordId))];
  ids.forEach(id => maybeAlert(records.find(x => x.id === id)));
}

function loadAlertForm(){
  const s = getAlertSettings();
  $('alertEmail').value = s.email;
  $('alertSubject').value = s.subject;
  $('alertUrl').value = s.url;
  $('alertToken').value = s.token;
}
function saveAlertForm(){
  const email = $('alertEmail').value.trim();
  if(email && !isValidEmail(email)){ toast('รูปแบบอีเมลไม่ถูกต้อง'); return false; }
  const s = {
    email,
    subject: $('alertSubject').value.trim() || ALERT_SUBJECT_DEFAULT,
    url: $('alertUrl').value.trim(),
    token: $('alertToken').value
  };
  const saved = saveAlertSettings(s);
  toast(saved ? 'บันทึกการตั้งค่าแจ้งเตือนแล้ว' : 'บันทึกไม่สำเร็จ');
  return saved;
}
async function testAlert(){
  if(!saveAlertForm()) return;
  const s = getAlertSettings();
  const res = await sendAlert({ to: s.email, subject: '[ทดสอบ] ' + s.subject, body: 'นี่คืออีเมลทดสอบจากระบบคัดกรองสุขภาพ', recordId: 'TEST', status: 'test' });
  toast(res.ok ? 'ส่งเมลทดสอบแล้ว ตรวจสอบกล่องจดหมาย' : 'ส่งไม่สำเร็จ: ' + res.error);
}

function toast(msg){
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2400);
}

async function loadRecordsRemote(){
  const { data, error } = await sb.from('screening_records').select('*').order('created_at');
  if(error){ toast('โหลดผลคัดกรองไม่สำเร็จ: ' + error.message); return; }
  records = data.map(r => ({ id: r.id, code: r.code, name: r.name, age: r.age, date: r.screen_date, sbp: r.sbp, dbp: r.dbp, fbs: r.fbs, answers: r.answers || {}, nurse_status: r.nurse_status, nurse_note: r.nurse_note, nurse_updated_at: r.nurse_updated_at }));
}

// ---- BP Home 7 วัน ----
let bpHome = [];
async function loadBpHome(){
  const { data, error } = await sb.from('bp_home_readings').select('record_id, day_number, measured_at, systolic, diastolic');
  if(error){ toast('โหลดข้อมูล BP Home ไม่สำเร็จ: ' + error.message); return; }
  bpHome = data;
}
function bpHomeFor(recordId){
  return bpHome.filter(x => x.record_id === recordId).sort((a, b) => a.day_number - b.day_number);
}
// คำนวณค่าเฉลี่ยเหมือนแอป HT Care (ตัดทศนิยมทิ้ง) เกินเกณฑ์เมื่อ ≥135/85
function bpHomeAverage(list){
  if(!list.length) return null;
  const sys = Math.floor(list.reduce((a, x) => a + x.systolic, 0) / list.length);
  const dia = Math.floor(list.reduce((a, x) => a + x.diastolic, 0) / list.length);
  return { sys, dia, days: new Set(list.map(x => x.day_number)).size, elevated: sys >= 135 || dia >= 85 };
}
function openBp(recordId){
  const r = records.find(x => x.id === recordId);
  if(!r) return;
  $('bpCard').dataset.record = recordId;
  $('bpName').textContent = r.name || r.code;
  $('bpDate').value = todayIso();
  $('bpSys').value = '';
  $('bpDia').value = '';
  $('bpSave').hidden = !canView('fu_record');
  renderBp();
  $('bpCard').hidden = false;
  $('bpCard').scrollIntoView({ behavior:'smooth', block:'center' });
}
function closeBp(){
  $('bpCard').hidden = true;
  delete $('bpCard').dataset.record;
}
function renderBp(){
  const id = $('bpCard').dataset.record;
  if(!id) return;
  const list = bpHomeFor(id);
  const avg = bpHomeAverage(list);
  $('bpRows').innerHTML = [1,2,3,4,5,6,7].map(day => {
    const hits = list.filter(x => x.day_number === day);
    const last = hits[hits.length - 1];
    return `<tr><td>วันที่ ${day}</td><td>${last ? fmtDate(last.measured_at) : '-'}</td><td>${last ? `${last.systolic}/${last.diastolic}` : '-'}</td></tr>`;
  }).join('');
  $('bpSummary').innerHTML = avg
    ? `ค่าเฉลี่ย <b>${avg.sys}/${avg.dia}</b> mmHg จาก ${avg.days} วัน · <span class="badge ${avg.elevated ? 'b-bad' : 'b-ok'}">${avg.elevated ? 'เกินเกณฑ์ (≥135/85) ควรพบแพทย์' : 'อยู่ในเกณฑ์ปกติ (<135/85)'}</span>`
    : 'ยังไม่มีข้อมูลการวัดที่บ้าน';
}
async function saveBp(){
  if(!canView('fu_record')){ toast('บันทึกได้เฉพาะ อสม.'); return; }
  const id = $('bpCard').dataset.record;
  const day = Number($('bpDay').value);
  const sys = parseInt($('bpSys').value, 10);
  const dia = parseInt($('bpDia').value, 10);
  const measured_at = $('bpDate').value;
  if(!sys || !dia){ toast('กรุณากรอกค่าความดันให้ครบ'); return; }
  if(!measured_at){ toast('กรุณาเลือกวันที่วัด'); return; }
  const row = { record_id: id, day_number: day, measured_at, systolic: sys, diastolic: dia };
  const { error } = await sb.from('bp_home_readings').insert(row);
  if(error){ toast('บันทึกไม่สำเร็จ: ' + error.message); return; }
  bpHome.push(row);
  $('bpSys').value = '';
  $('bpDia').value = '';
  renderBp();
  renderFollowUp();
  toast('บันทึกการวัดที่บ้านแล้ว');
}

// ---- หน้ารายละเอียดผู้ป่วย: สถานะพยาบาลและบันทึกความดัน ----
const NURSE_STATUS = [
  ['pending_review', 'รอตรวจสอบ'],
  ['acknowledged', 'รับทราบแล้ว'],
  ['monitoring_home_bp', 'กำลังติดตาม BP Home 7 วัน'],
  ['completed_evaluation', 'ติดตามครบตามแผน รอสรุปผล'],
  ['referred_to_doctor', 'ประสานส่งต่อพบแพทย์แล้ว'],
  ['follow_up_needed', 'ติดตามเพิ่มเติม']
];
let bpLogs = [];
async function loadBpLogs(){
  const { data, error } = await sb.from('bp_logs').select('record_id, measured_at, session, systolic, diastolic').order('measured_at');
  if(error){ toast('โหลดบันทึกความดันไม่สำเร็จ: ' + error.message); return; }
  bpLogs = data;
}
function renderLogs(){
  const list = bpLogs.filter(x => x.record_id === currentPatientId).slice().reverse();
  $('blRows').innerHTML = list.length ? list.map(x => `<tr>
      <td>${fmtDate(x.measured_at)}</td><td>${esc(x.session)}</td><td>${x.systolic}/${x.diastolic}</td>
    </tr>`).join('') : '<tr><td colspan="3" style="text-align:center;color:var(--muted);padding:20px">ยังไม่มีการบันทึก</td></tr>';
}
async function saveLog(){
  if(!canView('fu_record')){ toast('บันทึกความดันได้เฉพาะ อสม.'); return; }
  const sys = parseInt($('blSys').value, 10);
  const dia = parseInt($('blDia').value, 10);
  const measured_at = $('blDate').value;
  if(!sys || !dia){ toast('กรุณากรอกค่าความดันให้ครบ'); return; }
  if(!measured_at){ toast('กรุณาเลือกวันที่วัด'); return; }
  const row = { record_id: currentPatientId, measured_at, session: $('blSession').value, systolic: sys, diastolic: dia };
  const { error } = await sb.from('bp_logs').insert(row);
  if(error){ toast('บันทึกไม่สำเร็จ: ' + error.message); return; }
  bpLogs.push(row);
  $('blSys').value = '';
  $('blDia').value = '';
  renderLogs();
  toast('บันทึกความดันแล้ว');
}
async function saveNurse(){
  if(!canView('followup')){ toast('เฉพาะพยาบาลบันทึกสถานะได้'); return; }
  const r = records.find(x => x.id === currentPatientId);
  if(!r) return;
  const nurse_status = $('nsStatus').value;
  const nurse_note = $('nsNote').value.trim();
  const nurse_updated_at = new Date().toISOString();
  const { error } = await sb.from('screening_records').update({ nurse_status, nurse_note, nurse_updated_at }).eq('id', r.id);
  if(error){ toast('บันทึกสถานะไม่สำเร็จ: ' + error.message); return; }
  Object.assign(r, { nurse_status, nurse_note, nurse_updated_at });
  toast('บันทึกสถานะแล้ว');
}
$('nsSave').addEventListener('click', saveNurse);
$('blSave').addEventListener('click', saveLog);

// ---- การแจ้งเตือน ----
let acks = [];
async function loadAcks(){
  const { data, error } = await sb.from('notification_acks').select('record_id, kind');
  if(error){ toast('โหลดการรับทราบไม่สำเร็จ: ' + error.message); return; }
  acks = data;
}
const NOTIFY_TITLE = {
  URGENT: '🚨 ความดันสูงวิกฤต',
  SUSPECTED: '⚠️ เข้าเกณฑ์สงสัยป่วย',
  COMPLETED_7DAYS: '✅ ติดตามครบ 7 วัน',
  MISSED_DAYS: '⚠️ ขาดการบันทึก'
};
function notifyItems(){
  const today = todayIso();
  const items = [];
  records.forEach(r => {
    const st = statusOf(r);
    if(st === 'normal') return;
    const avg = bpHomeAverage(bpHomeFor(r.id));
    const days = avg ? avg.days : 0;
    if(st === 'refer') items.push({ key:'URGENT', type:'URGENT', r });
    else items.push({ key:'SUSPECTED', type:'SUSPECTED', r });
    if(days >= 7) items.push({ key:'COMPLETED_7DAYS', type:'COMPLETED_7DAYS', r });
    else if(today > addDays(r.date, 7)) items.push({ key:'MISSED_DAYS', type:'MISSED_DAYS', r });
  });
  const acked = new Set(acks.map(a => a.record_id + '|' + a.kind));
  return items.map(it => ({ ...it, done: acked.has(it.r.id + '|' + it.key) }))
    .sort((a, b) => Number(a.done) - Number(b.done));
}
function renderNotify(){
  const items = notifyItems();
  $('ntRows').innerHTML = items.length ? items.map(it => `<tr>
      <td>${NOTIFY_TITLE[it.type]}</td>
      <td>${esc(it.r.name || it.r.code)}<small> · ${esc(it.r.code)}</small></td>
      <td>${fmtDate(it.r.date)}</td>
      <td>${it.done ? '<span class="badge b-ok">รับทราบแล้ว</span>' : '<span class="badge b-warn">ยังไม่รับทราบ</span>'}</td>
      <td>
        ${it.done ? '' : `<button class="btn-ghost" data-ack="${esc(it.key)}" data-rec="${esc(it.r.id)}">รับทราบแล้ว</button>`}
        <button class="btn-ghost" data-detail="${esc(it.r.id)}">ดูรายละเอียด</button>
      </td>
    </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:20px">ไม่มีการแจ้งเตือน</td></tr>';
}
async function ackNotify(key, recordId){
  const row = { record_id: recordId, kind: key };
  const { error } = await sb.from('notification_acks').insert(row);
  if(error){ toast('บันทึกการรับทราบไม่สำเร็จ: ' + error.message); return; }
  acks.push(row);
  renderNotify();
  toast('รับทราบแล้ว');
}
$('ntRows').addEventListener('click', e => {
  const btn = e.target.closest('[data-ack]');
  if(btn) ackNotify(btn.dataset.ack, btn.dataset.rec);
});

// ---- หน้ารายละเอียดผู้ป่วย ----
let currentPatientId = null;
function openPatient(id){
  currentPatientId = id;
  setView('patient');
}

// กราฟแนวโน้มความดัน: จุดแรกคือค่าแรกรับ ตามด้วยค่าล่าสุดของแต่ละวันใน BP Home
function trendSvg(r, list){
  const pts = [{ x:0, s:r.sbp, d:r.dbp }];
  for(let day = 1; day <= 7; day++){
    const hit = list.filter(x => x.day_number === day).slice(-1)[0];
    if(hit) pts.push({ x:day, s:hit.systolic, d:hit.diastolic });
  }
  const W = 600, H = 220, P = 34;
  const X = x => P + (x / 7) * (W - 2 * P);
  const Y = v => H - P - ((Math.min(Math.max(v, 60), 200) - 60) / 140) * (H - 2 * P);
  const line = key => pts.map((p, k) => `${k ? 'L' : 'M'}${X(p.x)},${Y(p[key])}`).join('');
  const dots = key => pts.map(p => `<circle cx="${X(p.x)}" cy="${Y(p[key])}" r="4"/>`).join('');
  const labels = [0,1,2,3,4,5,6,7].map(x => `<text x="${X(x)}" y="${H - 10}" text-anchor="middle">${x ? 'วัน' + x : 'แรกรับ'}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="กราฟความดันโลหิต">
    <line x1="${P}" x2="${W - P}" y1="${Y(140)}" y2="${Y(140)}" stroke="#dc2626" stroke-dasharray="6 4"/>
    <path d="${line('s')}" fill="none" stroke="#0f766e" stroke-width="2.5"/>
    <path d="${line('d')}" fill="none" stroke="#2563eb" stroke-width="2.5"/>
    <g fill="#0f766e">${dots('s')}</g>
    <g fill="#2563eb">${dots('d')}</g>
    <g font-size="12" fill="#64748b">${labels}</g>
  </svg>
  <p class="note" style="margin-top:6px">● <span style="color:#0f766e">ความดันตัวบน</span> · ● <span style="color:#2563eb">ความดันตัวล่าง</span></p>`;
}

function renderPatient(){
  const r = records.find(x => x.id === currentPatientId);
  if(!r){ setView('register'); return; }
  const st = statusOf(r);
  const list = bpHomeFor(r.id);
  const avg = bpHomeAverage(list);
  const fus = followUps.filter(f => f.record_id === r.id).sort((a, b) => b.visited_at.localeCompare(a.visited_at));
  $('pdHead').innerHTML = `<div><h2>${esc(r.name || '-')}</h2><p>รหัส ${esc(r.code)} · อายุ ${esc(r.age || '-')} ปี · คัดกรองวันที่ ${fmtDate(r.date)}</p></div>
    <span class="badge ${BADGE[st][0]}">${BADGE[st][1]}</span>`;
  $('pdKpis').innerHTML = `
    <div class="kpi"><div class="label">ความดันแรกรับ</div><div class="value c-brand">${r.sbp}/${r.dbp}</div><div class="sub">mmHg</div></div>
    <div class="kpi"><div class="label">น้ำตาลในเลือด</div><div class="value c-teal">${r.fbs || '-'}</div><div class="sub">mg/dL</div></div>
    <div class="kpi"><div class="label">ค่าเฉลี่ย BP Home</div><div class="value ${avg && avg.elevated ? 'c-red' : 'c-blue'}">${avg ? avg.sys + '/' + avg.dia : '-'}</div><div class="sub">${avg ? avg.days + ' วันที่วัด' : 'ยังไม่มีข้อมูล'}</div></div>
    <div class="kpi"><div class="label">การติดตามล่าสุด</div><div class="value c-orange" style="font-size:18px">${fus[0] ? fmtDate(fus[0].visited_at) : '-'}</div><div class="sub">${fus[0] ? esc(fus[0].result) : 'ยังไม่มีการติดตาม'}</div></div>`;
  $('pdChart').innerHTML = trendSvg(r, list);
  $('nsStatus').innerHTML = NURSE_STATUS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
  $('nsStatus').value = r.nurse_status || 'pending_review';
  $('nsNote').value = r.nurse_note || '';
  $('nsSave').hidden = !canView('followup');
  $('nsStatus').disabled = !canView('followup');
  $('nsNote').disabled = !canView('followup');
  $('blDate').value = todayIso();
  $('blSys').value = '';
  $('blDia').value = '';
  $('blSave').hidden = !canView('fu_record');
  renderLogs();
  $('pdFollow').innerHTML = fus.length ? fus.map(f => `<tr>
      <td>${fmtDate(f.visited_at)}</td><td>${esc(f.result)}</td><td>${esc(f.note || '-')}</td>
    </tr>`).join('') : '<tr><td colspan="3" style="text-align:center;color:var(--muted);padding:20px">ยังไม่มีการติดตาม</td></tr>';
}
$('pdBack').addEventListener('click', () => setView('register'));

// ---- ทะเบียนและติดตาม ----
let followUps = [];
let regFilter = 'all';

function todayIso(){
  const t = new Date();
  return `${t.getFullYear()}-${pad(t.getMonth()+1)}-${pad(t.getDate())}`;
}
function addDays(iso, n){
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(y, m-1, d+n);
  return `${t.getFullYear()}-${pad(t.getMonth()+1)}-${pad(t.getDate())}`;
}
function isRisk(r){ return statusOf(r) !== 'normal'; }
function latestFollowUp(recordId){
  return followUps.filter(f => f.record_id === recordId).sort((a,b) => b.visited_at.localeCompare(a.visited_at))[0];
}
function followStatus(r){
  if(latestFollowUp(r.id)) return 'done';
  return todayIso() > addDays(r.date, 7) ? 'overdue' : 'pending';
}

async function loadFollowUps(){
  const { data, error } = await sb.from('follow_ups').select('record_id, visited_at, result, note');
  if(error){ toast('โหลดการติดตามไม่สำเร็จ: ' + error.message); return; }
  followUps = data;
}

function regList(){
  const q = $('regSearch').value.trim().toLowerCase();
  return records
    .filter(r => regFilter === 'all' || statusOf(r) === regFilter)
    .filter(r => !q || (r.name || '').toLowerCase().includes(q) || (r.code || '').toLowerCase().includes(q))
    .slice().reverse();
}
function renderRegister(){
  const cnt = { all: records.length, normal: 0, recheck: 0, refer: 0 };
  records.forEach(r => cnt[statusOf(r)]++);
  $('cntAll').textContent = cnt.all;
  $('cntNormal').textContent = cnt.normal;
  $('cntRecheck').textContent = cnt.recheck;
  $('cntRefer').textContent = cnt.refer;
  document.querySelectorAll('#view-register [data-filter]').forEach(b => {
    b.classList.toggle('btn-primary', b.dataset.filter === regFilter);
  });
  const list = regList();
  $('regRows').innerHTML = list.length ? list.map(r => {
    const st = statusOf(r);
    return `<tr>
      <td>${fmtDate(r.date)}</td>
      <td class="code">${esc(r.code)}</td>
      <td>${esc(r.name || '')}</td>
      <td>${esc(r.age || '-')}</td>
      <td>${r.sbp}/${r.dbp}</td>
      <td>${r.fbs || '-'}</td>
      <td><span class="badge ${BADGE[st][0]}">${BADGE[st][1]}</span></td>
      <td><button class="btn-ghost" data-detail="${esc(r.id)}">ดูรายละเอียด</button></td>
    </tr>`;
  }).join('') : '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:20px">ไม่พบข้อมูล</td></tr>';
}

const FU_LABEL = { pending:['b-warn','รอติดตาม'], overdue:['b-bad','เกินกำหนด'], done:['b-ok','ติดตามแล้ว'] };
function renderFollowUp(){
  const risk = records.filter(isRisk).slice().reverse();
  const rows = risk.map(r => ({ r, st: followStatus(r) }));
  $('fuPending').textContent = rows.filter(x => x.st === 'pending').length;
  $('fuOverdue').textContent = rows.filter(x => x.st === 'overdue').length;
  $('fuDone').textContent = rows.filter(x => x.st === 'done').length;
  $('fuRows').innerHTML = rows.length ? rows.map(({ r, st }) => {
    const last = latestFollowUp(r.id);
    return `<tr>
      <td class="code">${esc(r.code)}</td>
      <td>${esc(r.name || '')}</td>
      <td>${fmtDate(r.date)}</td>
      <td>${fmtDate(addDays(r.date, 7))}</td>
      <td><span class="badge ${FU_LABEL[st][0]}">${FU_LABEL[st][1]}</span></td>
      <td>${last ? fmtDate(last.visited_at) + ' · ' + esc(last.result) : '-'}</td>
      <td><button class="btn-ghost" data-bphome="${esc(r.id)}">BP Home</button> ${canView('fu_record') ? `<button class="btn-ghost" data-follow="${esc(r.id)}">บันทึกการติดตาม</button>` : ''}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:20px">ยังไม่มีผู้ที่ต้องติดตาม</td></tr>';
}

function openFollow(id){
  const r = records.find(x => x.id === id);
  if(!r) return;
  $('fuCard').dataset.record = id;
  $('fuName').textContent = r.name || r.code;
  $('fuDate').value = todayIso();
  $('fuNote').value = '';
  $('fuCard').hidden = false;
  $('fuCard').scrollIntoView({ behavior:'smooth', block:'center' });
}
function closeFollow(){
  $('fuCard').hidden = true;
  delete $('fuCard').dataset.record;
}
async function saveFollow(){
  if(!canView('fu_record')){ toast('บันทึกผลติดตามได้เฉพาะ อสม.'); return; }
  const id = $('fuCard').dataset.record;
  const visited_at = $('fuDate').value;
  if(!id) return;
  if(!visited_at){ toast('กรุณาเลือกวันที่ติดตาม'); return; }
  const row = { record_id: id, visited_at, result: $('fuResult').value, note: $('fuNote').value.trim() };
  const { error } = await sb.from('follow_ups').insert(row);
  if(error){ toast('บันทึกการติดตามไม่สำเร็จ: ' + error.message); return; }
  followUps.push(row);
  closeFollow();
  renderFollowUp();
  toast('บันทึกการติดตามแล้ว');
}

// ส่งออกทะเบียนพร้อมคำตอบแบบสอบถามทั้งชุด (คอลัมน์ตามชื่อช่องในฟอร์ม)
function exportRecordsCsv(list){
  if(!list.length){ toast('ไม่มีข้อมูลให้ส่งออก'); return; }
  const keys = [...new Set(list.flatMap(r => Object.keys(r.answers || {})))];
  const head = ['วันที่','รหัส','ชื่อ-สกุล','อายุ','ความดันตัวบน','ความดันตัวล่าง','น้ำตาลในเลือด','ผลคัดกรอง', ...keys];
  const rows = list.map(r => [fmtDate(r.date), r.code, r.name, r.age || '', r.sbp, r.dbp, r.fbs || '', BADGE[statusOf(r)][1], ...keys.map(k => (r.answers || {})[k] ?? '')]);
  const csv = '\uFEFF' + [head, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ทะเบียนคัดกรอง_' + todayIso() + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('ส่งออกไฟล์ CSV แล้ว');
}

// โหลดข้อมูลจาก Supabase หลังเข้าสู่ระบบ
async function loadData(){
  await loadRecordsRemote();
  await loadFollowUps();
  await loadBpHome();
  await loadBpLogs();
  await loadAcks();
  if(canView('admin')) await loadUsers();
  renderDashboard();
  renderAdmin();
  renderRegister();
  renderFollowUp();
}

function renderDashboard(){
  const people = new Set(records.map(r => r.code || r.name)).size;
  const total = records.length;
  const counts = { normal:0, recheck:0, refer:0 };
  records.forEach(r => counts[statusOf(r)]++);

  // ตัวเลขตามแดชบอร์ดของแอป HT Care
  const risk = records.filter(isRisk);
  const overdue = risk.filter(r => followStatus(r) === 'overdue');
  const seven = risk.filter(r => (bpHomeAverage(bpHomeFor(r.id)) || { days: 0 }).days >= 7);
  $('kpiScreened').textContent = total;
  $('kpiSuspect').textContent = counts.recheck;
  $('kpiTracking').textContent = risk.filter(r => followStatus(r) === 'pending').length;
  $('kpiSeven').textContent = seven.length;
  $('kpiUrgent').textContent = new Set([...records.filter(r => statusOf(r) === 'refer'), ...overdue].map(r => r.id)).size;
  $('thNormal').textContent = counts.normal + ' ราย';
  $('thSuspect').textContent = counts.recheck + ' ราย';
  $('thUrgent').textContent = counts.refer + ' ราย';

  $('sumNormal').textContent = counts.normal + ' คน';
  $('sumRecheck').textContent = counts.recheck + ' คน';
  $('sumRefer').textContent = counts.refer + ' รายการ';
  $('sumTotal').textContent = total + ' รายการ';

  const todo = records.filter(r => statusOf(r) !== 'normal').slice().reverse().slice(0,5);
  const body = $('todoBody');
  if(!todo.length){
    body.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:20px">ไม่มีรายการที่ต้องดำเนินการ</td></tr>';
    return;
  }
  body.innerHTML = todo.map(r => {
    const st = statusOf(r);
    return `<tr>
      <td class="code">${esc(r.code)}</td>
      <td class="pname">${esc(r.name)}<small>${fmtDate(r.date)}</small></td>
      <td>${esc(typeOf(r))}</td>
      <td><span class="badge ${BADGE[st][0]}">${BADGE[st][1]}</span></td>
      <td><button class="btn-ghost" data-detail="${esc(r.id)}">ดูรายการ</button></td>
    </tr>`;
  }).join('');
}

function setDefaults(){
  const d = new Date();
  $('fDay').value = d.getDate();
  $('fMonth').value = d.getMonth();
  $('fYear').value = d.getFullYear() + 543;
  $('fHour').value = pad(d.getHours());
  $('fMinute').value = pad(d.getMinutes());
  updateBmi();
}

function fillMock(){
  // ค่าตัวอย่างแสดงเป็น placeholder (ตัวอักษรจาง) ช่องยังว่างอยู่ พิมพ์ทับได้เลย
  const hints = {
    pName:'ตัวอย่าง ใจดี', pAge:'36', pHouse:'125', pMoo:'9',
    pTambon:'บ้านป่า', pAmp:'เมืองพิษณุโลก', fScreener:'ตัวอย่าง อสม.',
    fWeight:'85', fHeight:'175', fSbp:'165', fDbp:'98', fSugar:'156'
  };
  Object.entries(hints).forEach(([id,v]) => { $(id).placeholder = v; });
  $('fHour').value = '12'; $('fMinute').value = '02';
  updateBmi();
}

function updateBmi(){
  const w = parseFloat($('fWeight').value);
  const h = parseFloat($('fHeight').value);
  $('fBmi').value = (w>0 && h>0) ? (w / ((h/100)**2)).toFixed(2) : '-';
}

function readForm(){
  const n = id => parseFloat($(id).value) || 0;
  const v = id => $(id).value.trim();
  return {
    name: v('pName'),
    age: v('pAge'),
    date: `${Number($('fYear').value)-543}-${pad(Number($('fMonth').value)+1)}-${pad(Number($('fDay').value))}`,
    time: `${$('fHour').value}:${$('fMinute').value}`,
    sbp: n('fSbp'), dbp: n('fDbp'), fbs: n('fSugar'),
    fasting: $('fFasting').value,
    weight: n('fWeight'), height: n('fHeight')
  };
}

function showResult(f, st){
  const bpHigh = f.sbp>=140 || f.dbp>=90;
  const sgHigh = f.fbs>=126;
  const bpMsg = bpHigh
    ? 'พบค่าความดันถึงเกณฑ์เฝ้าระวัง ให้นั่งพักอย่างน้อย 15 นาที แล้ววัดความดันโลหิตซ้ำด้วยวิธีที่ถูกต้อง หากยังพบค่าผิดปกติให้ประสานบุคลากรทางการแพทย์เพื่อประเมินต่อ'
    : 'ค่าความดันโลหิตอยู่ในเกณฑ์ที่ยังไม่ต้องติดตามเพิ่มเติม';
  let sgMsg = 'ค่าน้ำตาลอยู่ในเกณฑ์ที่ยังไม่ต้องติดตามเพิ่มเติม';
  if(sgHigh) sgMsg = 'ค่าน้ำตาลถึงเกณฑ์ติดตาม ควรปรึกษาบุคลากรทางการแพทย์เพื่อพิจารณาตรวจซ้ำ';
  else if(f.fbs>0 && f.fasting !== 'fast8') sgMsg = 'ยังไม่ได้งดอาหารครบ 8 ชั่วโมง ควรตรวจซ้ำให้ถูกวิธี';

  const titles = {
    normal: 'ผลคัดกรองเบื้องต้น: ปกติตามเกณฑ์',
    recheck: 'ผลคัดกรองเบื้องต้น: ต้องประเมินเพิ่มเติม',
    refer: 'ผลคัดกรองเบื้องต้น: ควรส่งต่อบุคลากรทางการแพทย์'
  };
  const box = $('result');
  box.className = 'result show ' + (st === 'normal' ? 'r-ok' : st === 'refer' ? 'r-bad' : '');
  $('resultTitle').textContent = titles[st];
  $('resultBp').textContent = bpMsg;
  $('resultSugar').textContent = sgMsg;
  box.scrollIntoView({behavior:'smooth', block:'nearest'});
}

// รวมค่าทุกช่องในฟอร์มคัดกรองเป็นอ็อบเจกต์ เพื่อเก็บเป็นแบบสอบถามทั้งชุด
function collectForm(){
  const out = {};
  document.querySelectorAll('#view-form input, #view-form select, #view-form textarea').forEach(el => {
    if(el.id) out[el.id] = el.type === 'checkbox' ? el.checked : el.value;
  });
  return out;
}

async function evaluate(){
  const f = readForm();
  if(!f.name){ toast('กรุณากรอกชื่อ-นามสกุล'); return; }
  if(!f.sbp || !f.dbp){ toast('กรุณากรอกค่าความดันโลหิต'); return; }

  const st = statusOf(f);
  const { data, error } = await sb.from('screening_records').insert({
    code: 'REC-' + pad(records.length + 1),
    name: f.name,
    age: parseInt(f.age, 10) || null,
    screen_date: f.date,
    sbp: Math.round(f.sbp), dbp: Math.round(f.dbp), fbs: Math.round(f.fbs) || null,
    answers: collectForm()
  }).select().single();
  if(error){ toast('บันทึกไม่สำเร็จ: ' + error.message); return; }

  const rec = { id: data.id, code: data.code, name: data.name, age: data.age, date: data.screen_date, sbp: data.sbp, dbp: data.dbp, fbs: data.fbs, answers: data.answers || {} };
  records.push(rec);
  renderDashboard();
  showResult(f, st);
  toast('บันทึกผลคัดกรองเรียบร้อยแล้ว');
  maybeAlert(rec);
}

function toggleQuitYears(){
  $('drinkYearWrap').style.display = $('fDrink').value === 'quit' ? '' : 'none';
  $('smokeYearWrap').style.display = $('fSmoke').value === 'quit' ? '' : 'none';
}

function clearForm(){
  document.querySelectorAll('#view-form input, #view-form textarea').forEach(el => {
    if(el.id === 'fBmi') return;
    el.value = '';
  });
  document.querySelectorAll('#view-form select').forEach(el => {
    if(['fDay','fMonth','fYear','fHour','fMinute'].includes(el.id)) return;
    el.selectedIndex = 0;
  });
  $('result').classList.remove('show');
  setDefaults();
  toggleQuitYears();
}

function allowedView(name){
  if(name === 'patient') return canView('dashboard') || canView('register') || canView('followup');
  if(name === 'notify') return canView('followup') || canView('register');
  return canView(name);
}

function setView(name){
  const allowed = allowedView(name);
  if(!allowed){
    toast('บัญชีนี้ไม่มีสิทธิ์เข้าหน้านี้');
    name = 'dashboard';
  }
  const views = { dashboard:'view-dashboard', form:'view-form', register:'view-register', followup:'view-followup', patient:'view-patient', notify:'view-notify', report:'view-report', admin:'view-admin' };
  Object.entries(views).forEach(([key,id]) => { $(id).hidden = key !== name; });
  document.querySelectorAll('.nav button[data-view]').forEach(b => {
    b.classList.toggle('active', b.dataset.view === name);
  });
  const shown = $(views[name]);
  shown.classList.remove('view-in');
  void shown.offsetWidth;
  shown.classList.add('view-in');
  closeSidebar();
  window.scrollTo(0,0);
  if(name === 'dashboard') renderDashboard();
  if(name === 'report') renderReport();
  if(name === 'admin') renderAdmin();
  if(name === 'register') renderRegister();
  if(name === 'followup') renderFollowUp();
  if(name === 'patient') renderPatient();
  if(name === 'notify') renderNotify();
}

function openSidebar(open){
  $('sidebar').classList.toggle('open', open);
  $('scrim').classList.toggle('show', open);
}
function closeSidebar(){ openSidebar(false); }


// ---- รายงาน ----
function filteredRecords(){
  const from = $('rFrom').value, to = $('rTo').value, st = $('rStatus').value;
  return records.filter(r =>
    (!from || r.date >= from) &&
    (!to || r.date <= to) &&
    (st === 'all' || statusOf(r) === st)
  );
}

function renderReport(){
  const list = filteredRecords();
  const n = list.length;
  const cnt = { normal:0, recheck:0, refer:0 };
  list.forEach(r => cnt[statusOf(r)]++);
  const pct = k => n ? ((cnt[k] / n) * 100).toFixed(1) : '0.0';

  $('rTotal').textContent = n;
  $('rPeople').textContent = new Set(list.map(r => r.code || r.name)).size;
  $('rNormal').textContent = cnt.normal;
  $('rAbnormal').textContent = cnt.recheck + cnt.refer;

  $('rSummary').innerHTML = ['normal','recheck','refer'].map(k =>
    `<tr><td><span class="badge ${BADGE[k][0]}">${BADGE[k][1]}</span></td><td>${cnt[k]}</td><td>${pct(k)}%</td></tr>`
  ).join('') + `<tr><th>รวม</th><th>${n}</th><th>${n ? '100.0' : '0.0'}%</th></tr>`;

  $('rDetail').innerHTML = n ? list.slice().reverse().map(r => {
    const st = statusOf(r);
    return `<tr>
      <td>${fmtDate(r.date)}</td>
      <td class="code">${esc(r.code)}</td>
      <td>${esc(r.name)}</td>
      <td>${esc(r.age || '-')}</td>
      <td>${r.sbp}/${r.dbp}</td>
      <td>${r.fbs || '-'}</td>
      <td><span class="badge ${BADGE[st][0]}">${BADGE[st][1]}</span></td>
    </tr>`;
  }).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:20px">ไม่พบข้อมูลตามเงื่อนไข</td></tr>';
}

function csvCell(v){
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
}

function exportCsv(){
  const list = filteredRecords();
  if(!list.length){ toast('ไม่มีข้อมูลให้ส่งออก'); return; }
  const head = ['วันที่','รหัส','ชื่อ-สกุล','อายุ','ความดันตัวบน','ความดันตัวล่าง','น้ำตาลในเลือด','ผลคัดกรอง'];
  const rows = list.map(r => [fmtDate(r.date), r.code, r.name, r.age || '', r.sbp, r.dbp, r.fbs || '', BADGE[statusOf(r)][1]]);
  // \uFEFF = BOM ทำให้ Excel อ่านภาษาไทยถูกต้อง
  const csv = '\uFEFF' + [head, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'รายงานคัดกรอง_' + new Date().toISOString().slice(0,10) + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('ส่งออกไฟล์ CSV แล้ว เปิดด้วย Excel ได้เลย');
}


// ---- เข้าสู่ระบบ (ชื่อผู้ใช้และรหัสผ่าน) ----
const PAGES = [
  { key:'dashboard', label:'Dashboard' },
  { key:'form',      label:'คัดกรองสุขภาพ' },
  { key:'report',    label:'รายงานและส่งออก' },
  { key:'admin',     label:'ผู้ดูแลระบบ' },
  { key:'register',  label:'ทะเบียนผลคัดกรอง' },
  { key:'followup',  label:'ติดตามและจัดการแผน' },
  { key:'fu_record', label:'บันทึกผลติดตาม (อสม.)' }
];
const PRESET_STAFF = ['dashboard','form'];
const PRESET_ALL = PAGES.map(p => p.key);
const PAGE_LABEL = Object.fromEntries(PAGES.map(p => [p.key, p.label]));

async function sha256Hex(text){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}
function currentPages(){
  try{ const u = JSON.parse(localStorage.getItem('login_user') || 'null'); return u ? (u.pages || []) : []; }
  catch(e){ return []; }
}
function canView(name){
  return currentPages().includes(name);
}
function firstAllowedPage(){
  return PAGES.map(p => p.key).find(k => k !== 'admin' && canView(k)) || (canView('admin') ? 'admin' : 'dashboard');
}
function applyRights(){
  document.querySelectorAll('.nav button[data-view]').forEach(b => { b.hidden = !allowedView(b.dataset.view); });
  document.querySelectorAll('.nav button[data-admin]').forEach(b => { b.hidden = !canView('admin'); });
}
function enterApp(user){
  $('view-login').hidden = true;
  $('appRoot').hidden = false;
  $('whoami').textContent = user.name;
  $('whoRole').textContent = user.pages.includes('admin') ? 'ผู้ดูแลระบบ' : 'ผู้ใช้งาน';
  $('btnLogout').hidden = false;
  applyRights();
}
function showLoginError(msg){
  const el = $('loginError');
  el.textContent = msg;
  el.hidden = false;
}
async function logout(){
  if(sb) await sb.auth.signOut();
  try{ localStorage.removeItem('login_user'); }catch(e){}
  location.reload();
}
let sb = null;

// ออกจากระบบอัตโนมัติเมื่อไม่มีการใช้งานเกิน 10 นาที
const IDLE_LIMIT_MS = 10 * 60 * 1000;
let lastWrite = 0;
function touchActivity(){
  try{ localStorage.setItem('last_active', String(Date.now())); }catch(e){}
}
function onUserActivity(){
  if(Date.now() - lastWrite < 5000) return;
  lastWrite = Date.now();
  touchActivity();
}
function idleExpired(){
  const t = Number(localStorage.getItem('last_active') || 0);
  return !t || Date.now() - t > IDLE_LIMIT_MS;
}
function startIdleWatch(){
  ['click','keydown','mousemove','touchstart','scroll'].forEach(ev => document.addEventListener(ev, onUserActivity, { passive: true }));
  setInterval(() => { if(localStorage.getItem('login_user') && idleExpired()) logout(); }, 30000);
}

function initAuth(){
  sb = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY) : null;
  $('btnLogout').addEventListener('click', logout);
  let saved = null;
  try{ saved = JSON.parse(localStorage.getItem('login_user') || 'null'); }catch(e){}
  if(saved && idleExpired()){
    try{ localStorage.removeItem('login_user'); }catch(e){}
    if(sb) sb.auth.signOut();
    saved = null;
  }
  if(saved){
    enterApp(saved);
    if(sb) loadData();
    startIdleWatch();
    return;
  }
  $('appRoot').hidden = true;
  $('view-login').hidden = false;
  if(window.google) initGoogle();
}

// เรียกหลังโหลดสคริปต์ของ Google แล้ว
function initGoogle(){
  if(!window.google || !$('googleBtn')) return;
  google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: onGoogleCredential });
  google.accounts.id.renderButton($('googleBtn'), { theme: 'outline', size: 'large', text: 'signin_with', locale: 'th', width: 280 });
}

// อีเมลที่อนุญาตต้องมีแถวใน app_users และ active = true (RLS ตรวจให้ที่ฐานข้อมูล)
async function loadAllowedUser(email){
  const { data, error } = await sb.from('app_users').select('email, display_name, pages, active').ilike('email', email).maybeSingle();
  if(error || !data || !data.active) return null;
  return { username: email, name: data.display_name, pages: data.pages || [] };
}

async function onGoogleCredential(resp){
  $('loginError').hidden = true;
  if(!sb){ showLoginError('โหลดระบบเข้าสู่ระบบไม่สำเร็จ ตรวจสอบการเชื่อมต่ออินเทอร์เน็ต'); return; }
  const { data, error } = await sb.auth.signInWithIdToken({ provider: 'google', token: resp.credential });
  if(error || !data.user){ showLoginError('เข้าสู่ระบบด้วย Gmail ไม่สำเร็จ ลองใหม่อีกครั้ง'); return; }
  const user = await loadAllowedUser(data.user.email);
  if(!user){
    await sb.auth.signOut();
    showLoginError('อีเมลนี้ยังไม่ได้รับอนุญาตให้ใช้ระบบ กรุณาติดต่อผู้ดูแลระบบ');
    return;
  }
  if(!user.pages.length){
    await sb.auth.signOut();
    showLoginError('บัญชีนี้ยังไม่ได้กำหนดหน้าจอที่ใช้ได้ กรุณาติดต่อผู้ดูแลระบบ');
    return;
  }
  try{ localStorage.setItem('login_user', JSON.stringify(user)); }catch(e){}
  touchActivity();
  startIdleWatch();
  enterApp(user);
  setView(firstAllowedPage());
  await loadData();
}
initAuth();

// ---- ผู้ดูแลระบบ ----
// รายชื่อผู้ใช้ที่แก้ไขได้ เก็บในเบราว์เซอร์ (เริ่มจาก CONFIG.USERS ครั้งแรก)
let usersCache = [];
function getUsers(){ return usersCache; }

// โหลดรายชื่อผู้ใช้จาก app_users (เฉพาะแอดมินที่อ่านได้ทั้งหมด)
async function loadUsers(){
  const { data, error } = await sb.from('app_users').select('email, display_name, pages, active').order('email');
  if(error){ toast('โหลดรายชื่อผู้ใช้ไม่สำเร็จ: ' + error.message); return; }
  usersCache = data.map(r => ({ username: r.email, name: r.display_name, pages: r.pages || [] }));
}

// บันทึกรายการทั้งหมดลง app_users: upsert ทุกแถว และลบแถวที่หายไปจากรายการ
async function saveUsers(list){
  const removed = usersCache.filter(o => !list.some(n => n.username === o.username)).map(o => o.username);
  let res = await sb.from('app_users').upsert(list.map(u => ({ email: u.username, display_name: u.name, pages: u.pages, active: true })));
  if(!res.error && removed.length) res = await sb.from('app_users').delete().in('email', removed);
  if(res.error){ toast('บันทึกไม่สำเร็จ: ' + res.error.message); return false; }
  usersCache = list.map(u => ({ ...u }));
  return true;
}
function currentUsername(){
  try{ const u = JSON.parse(localStorage.getItem('login_user') || 'null'); return u ? u.username : null; }
  catch(e){ return null; }
}
function adminCount(list){ return list.filter(u => u.pages.includes('admin')).length; }

function renderAdmin(){
  const me = currentUsername();
  $('adminUsers').innerHTML = getUsers().map(u => {
    const self = me === u.username;
    const labels = u.pages.map(k => PAGE_LABEL[k]).filter(Boolean).join(', ') || '-';
    return `<tr>
      <td class="code">${esc(u.username)}${self ? ' <span class="badge b-ok">คุณ</span>' : ''}</td>
      <td>${esc(u.name)}</td>
      <td>${esc(labels)}</td>
      <td class="row-actions">
        <button class="btn-ghost" data-edit="${esc(u.username)}">แก้ไข</button>
        ${self ? '' : `<button class="btn-ghost" data-del="${esc(u.username)}">ลบ</button>`}
      </td>
    </tr>`;
  }).join('');
}

function setChecks(prefix, pages){
  PAGES.forEach(p => { $(prefix + p.key).checked = pages.includes(p.key); });
}
function readChecks(prefix){
  return PAGES.map(p => p.key).filter(k => $(prefix + k).checked);
}

// ---- เพิ่มผู้ใช้ใหม่ ----
function clearAddForm(){
  ['uName','uDisplay'].forEach(id => { $(id).value = ''; });
  setChecks('pg-', PRESET_STAFF);
}
async function addUser(){
  const username = $('uName').value.trim().toLowerCase();
  const name = $('uDisplay').value.trim();
  const pages = readChecks('pg-');
  if(!isValidEmail(username)){ toast('กรุณากรอกอีเมล Gmail ให้ถูกต้อง'); return; }
  if(!name){ toast('กรุณากรอกชื่อที่แสดง'); return; }
  if(!pages.length){ toast('เลือกหน้าจอที่ใช้ได้อย่างน้อย 1 หน้า'); return; }

  const list = getUsers();
  if(list.some(u => u.username === username)){
    toast('มีอีเมลนี้อยู่แล้ว ให้กดแก้ไขในตารางด้านบนแทน');
    return;
  }
  list.push({ username, name, pages });
  if(!(await saveUsers(list))) return;
  clearAddForm();
  renderAdmin();
  toast('เพิ่มผู้ใช้แล้ว');
}

// ---- แก้ไขผู้ใช้ (เปิดจากปุ่มแก้ไขในตาราง) ----
function openEdit(username){
  const u = getUsers().find(x => x.username === username);
  if(!u) return;
  $('editTitle').textContent = u.username;
  $('editCard').dataset.user = u.username;
  $('eDisplay').value = u.name;
  setChecks('eg-', u.pages);
  $('editCard').hidden = false;
  $('editCard').scrollIntoView({ behavior:'smooth', block:'center' });
}
function closeEdit(){
  $('editCard').hidden = true;
  delete $('editCard').dataset.user;
}
async function saveEdit(){
  const username = $('editCard').dataset.user;
  if(!username) return;
  const name = $('eDisplay').value.trim();
  const pages = readChecks('eg-');
  if(!name){ toast('กรุณากรอกชื่อที่แสดง'); return; }
  if(!pages.length){ toast('เลือกหน้าจอที่ใช้ได้อย่างน้อย 1 หน้า'); return; }

  const list = getUsers();
  const target = list.find(u => u.username === username);
  if(!target) return;
  const adminsAfter = list.filter(u => u.username !== username && u.pages.includes('admin')).length + (pages.includes('admin') ? 1 : 0);
  if(adminsAfter === 0){ toast('ต้องมีผู้ดูแลระบบอย่างน้อย 1 คน'); return; }

  Object.assign(target, { name, pages });
  if(!(await saveUsers(list))) return;

  // ถ้าแก้บัญชีที่กำลังใช้อยู่ ให้สิทธิ์มีผลทันที
  if(currentUsername() === username){
    const me = { username, name, pages };
    try{ localStorage.setItem('login_user', JSON.stringify(me)); }catch(e){}
    enterApp(me);
    const active = document.querySelector('.nav button.active');
    if(!canView(active ? active.dataset.view : 'dashboard')) setView(firstAllowedPage());
  }
  closeEdit();
  renderAdmin();
  toast('บันทึกการแก้ไขแล้ว');
}

// ---- ลบผู้ใช้ ----
async function deleteUser(username){
  if(currentUsername() === username){ toast('ลบบัญชีที่กำลังใช้อยู่ไม่ได้'); return; }
  const list = getUsers();
  const target = list.find(u => u.username === username);
  if(!target) return;
  if(target.pages.includes('admin') && adminCount(list) <= 1){ toast('ต้องมีผู้ดูแลระบบอย่างน้อย 1 คน'); return; }
  if(!window.confirm('ลบผู้ใช้ ' + username + ' ใช่หรือไม่')) return;
  if(!(await saveUsers(list.filter(u => u.username !== username)))) return;
  if(!$('editCard').hidden && $('editCard').dataset.user === username) closeEdit();
  renderAdmin();
  toast('ลบผู้ใช้แล้ว');
}

$('btnSaveUser').addEventListener('click', addUser);
$('presetStaff').addEventListener('click', () => setChecks('pg-', PRESET_STAFF));
$('presetAdmin').addEventListener('click', () => setChecks('pg-', PRESET_ALL));
$('btnUpdateUser').addEventListener('click', saveEdit);
$('btnCancelEdit').addEventListener('click', closeEdit);
$('adminUsers').addEventListener('click', e => {
  const edit = e.target.closest('[data-edit]');
  if(edit){ openEdit(edit.dataset.edit); return; }
  const del = e.target.closest('[data-del]');
  if(del){ deleteUser(del.dataset.del); }
});

// ---- init ----
applyRights();
$('todayThai').textContent = (() => {
  const d = new Date();
  return `${d.getDate()} ${TH_MONTHS[d.getMonth()]} ${d.getFullYear()+543}`;
})();

$('fDay').innerHTML = range(1,31).map(d => opt(d, pad(d))).join('');
$('fMonth').innerHTML = TH_MONTHS.map((m,i) => opt(i, m)).join('');
const beNow = new Date().getFullYear() + 543;
$('fYear').innerHTML = range(beNow-5, beNow+1).map(y => opt(y, y)).join('');
$('fHour').innerHTML = range(0,23).map(h => opt(pad(h), pad(h))).join('');
$('fMinute').innerHTML = range(0,59).map(m => opt(pad(m), pad(m))).join('');

setDefaults();
fillMock();
renderDashboard();

$('fDrink').addEventListener('change', toggleQuitYears);
$('fSmoke').addEventListener('change', toggleQuitYears);
toggleQuitYears();
['rFrom','rTo','rStatus'].forEach(id => $(id).addEventListener('change', renderReport));
$('rTo').value = new Date().toISOString().slice(0,10);
$('btnExport').addEventListener('click', exportCsv);
$('btnPrint').addEventListener('click', () => window.print());
$('fWeight').addEventListener('input', updateBmi);
$('fHeight').addEventListener('input', updateBmi);
$('btnEval').addEventListener('click', evaluate);
$('btnClear').addEventListener('click', clearForm);

document.querySelectorAll('.nav button[data-view]').forEach(b => {
  b.addEventListener('click', () => setView(b.dataset.view));
});
document.querySelectorAll('.nav button[data-stub]').forEach(b => {
  b.addEventListener('click', () => { toast(b.dataset.stub + ' · อยู่ในขั้นตอนพัฒนา'); closeSidebar(); });
});
document.querySelector('.content').addEventListener('click', e => {
  const btn = e.target.closest('[data-detail]');
  if(btn) openPatient(btn.dataset.detail);
});

$('menuBtn').addEventListener('click', () => openSidebar(!$('sidebar').classList.contains('open')));
$('scrim').addEventListener('click', closeSidebar);

$('btnSaveAlert').addEventListener('click', saveAlertForm);
$('btnTestAlert').addEventListener('click', testAlert);
$('regSearch').addEventListener('input', renderRegister);
document.querySelectorAll('#view-register [data-filter]').forEach(b => {
  b.addEventListener('click', () => { regFilter = b.dataset.filter; renderRegister(); });
});
$('regExport').addEventListener('click', () => exportRecordsCsv(regList()));
$('fuSave').addEventListener('click', saveFollow);
$('fuCancel').addEventListener('click', closeFollow);
$('fuRows').addEventListener('click', e => {
  const btn = e.target.closest('[data-follow]');
  if(btn) openFollow(btn.dataset.follow);
  const bp = e.target.closest('[data-bphome]');
  if(bp) openBp(bp.dataset.bphome);
});
$('bpSave').addEventListener('click', saveBp);
$('bpClose').addEventListener('click', closeBp);
loadAlertForm();
retryPendingAlerts();

setView('dashboard');
