// ระบบติดตามมติที่ประชุม — โค้ดหลัก
// ข้อมูลทั้งหมดเก็บใน localStorage ของ browser

'use strict';

// =====================================================================
// ค่าคงที่
// =====================================================================

// ชื่อที่ใช้เก็บข้อมูลใน localStorage (ห้ามเปลี่ยน ไม่อย่างนั้นข้อมูลเดิมจะหาไม่เจอ)
const STORAGE_KEY = 'meetingTracker.items';
const LAST_CHANGE_KEY = 'meetingTracker.lastChange';   // เวลาที่แก้ข้อมูลล่าสุด
const LAST_EXPORT_KEY = 'meetingTracker.lastExport';   // เวลาที่สำรองเป็น Excel ล่าสุด

// สถานะ: ค่าที่เก็บในระบบ → ข้อความที่แสดง
const STATUS_LABELS = {
  not_started: 'ยังไม่เริ่ม',
  in_progress: 'กำลังดำเนินการ',
  done: 'เสร็จแล้ว',
};

// =====================================================================
// ข้อมูล
// =====================================================================

// รายการมติทั้งหมด แต่ละรายการมีหน้าตาแบบนี้:
// {
//   id, meetingName, meetingNo, meetingDate, resolution,
//   owners,      // ข้อความ คั่นด้วยจุลภาค เช่น "คุณ ก, คุณ ข"
//   emails,      // ข้อความ คั่นด้วยจุลภาค เช่น "a@x.com, b@x.com"
//   dueDate, status, note,
//   sentDates,   // วันที่บันทึกว่าส่งอีเมลแล้ว เรียงจากเก่าไปใหม่ เช่น ["2026-10-25", "2026-11-10"]
//   createdAt, updatedAt
// }
// วันที่ทั้งหมดเก็บเป็นรูปแบบ "ปปปป-ดด-วว" แบบ ค.ศ. เช่น "2026-11-10"
let items = [];

function loadItems() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    // ข้อมูลเสีย: เก็บสำเนาไว้ก่อน จะได้ไม่ถูกเขียนทับจนกู้ไม่ได้
    localStorage.setItem(STORAGE_KEY + '.broken.' + Date.now(), raw);
    alert('ข้อมูลที่บันทึกไว้อ่านไม่ได้ ระบบเก็บสำเนาไว้แล้ว และจะเริ่มจากตารางว่าง\nกรุณานำเข้าจากไฟล์ Excel ที่สำรองไว้');
    return [];
  }
}

function saveItems() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    // จำเวลาที่แก้ข้อมูลล่าสุด เพื่อเตือนว่ามีข้อมูลใหม่ที่ยังไม่ได้สำรอง
    localStorage.setItem(LAST_CHANGE_KEY, new Date().toISOString());
    renderBackupStatus();
    return true;
  } catch (err) {
    alert('บันทึกข้อมูลไม่สำเร็จ: ' + err.message);
    return false;
  }
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// =====================================================================
// ฟังก์ชันช่วย
// =====================================================================

// แยกข้อความที่คั่นด้วยจุลภาค (หรือ ; ) เป็นรายการ และตัดช่องว่างหัวท้าย
function splitList(text) {
  return String(text || '')
    .split(/[,;，]/)
    .map(s => s.trim())
    .filter(s => s !== '');
}

// รวมรายการกลับเป็นข้อความรูปแบบเดียวกันทุกครั้ง "ก, ข, ค"
function joinList(list) {
  return list.join(', ');
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// วันนี้ในรูปแบบ "ปปปป-ดด-วว" ตามเวลาเครื่อง
function todayIso() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

// "2026-11-10" → "10 พ.ย. 2569"
const thaiDateFormat = new Intl.DateTimeFormat('th-TH', {
  day: 'numeric', month: 'short', year: 'numeric',
});
function formatThaiDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return thaiDateFormat.format(new Date(y, m - 1, d));
}

// "2026-11-10" → "10 พฤศจิกายน 2569" (ใช้ในอีเมล)
const thaiDateLongFormat = new Intl.DateTimeFormat('th-TH', {
  day: 'numeric', month: 'long', year: 'numeric',
});
function formatThaiDateLong(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return thaiDateLongFormat.format(new Date(y, m - 1, d));
}

// ป้องกันข้อความที่ผู้ใช้กรอกถูกตีความเป็นโค้ด HTML
function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// แปลงขึ้นบรรทัดใหม่ให้แสดงในตารางได้
function multiline(text) {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

// =====================================================================
// ตาราง
// =====================================================================

// สถานะการแสดงผลปัจจุบัน (ตัวกรอง + การเรียง)
const view = {
  status: 'all',     // all | not_done | overdue | not_started | in_progress | done
  owner: '',         // '' = ทุกคน
  text: '',          // คำค้นหา
  sortKey: 'dueDate',
  sortDir: 1,        // 1 = น้อยไปมาก, -1 = มากไปน้อย
};

// ลำดับสถานะเวลาเรียง
const STATUS_ORDER = { not_started: 0, in_progress: 1, done: 2 };

// วิธีหยิบค่าที่ใช้เรียงของแต่ละคอลัมน์
const SORT_VALUES = {
  meeting: i => i.meetingName + ' ' + i.meetingNo,
  meetingDate: i => i.meetingDate,
  owners: i => i.owners,
  dueDate: i => i.dueDate,
  status: i => STATUS_ORDER[i.status] ?? 9,
};

// เลยกำหนด = กำหนดเสร็จผ่านไปแล้ว และยังไม่เสร็จ
function isOverdue(item, today) {
  return item.status !== 'done' && !!item.dueDate && item.dueDate < today;
}

// จำนวนวันระหว่างวันที่สองวัน (รูปแบบ "ปปปป-ดด-วว")
function daysBetween(fromIso, toIso) {
  const toUtc = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((toUtc(toIso) - toUtc(fromIso)) / 86400000);
}

function matchesFilters(item, today) {
  if (view.status === 'not_done' && item.status === 'done') return false;
  if (view.status === 'overdue' && !isOverdue(item, today)) return false;
  if (STATUS_LABELS[view.status] && item.status !== view.status) return false;

  if (view.owner && !splitList(item.owners).includes(view.owner)) return false;

  if (view.text) {
    const haystack = [item.meetingName, item.meetingNo, item.resolution,
                      item.owners, item.emails, item.note].join(' ').toLowerCase();
    if (!haystack.includes(view.text.toLowerCase())) return false;
  }
  return true;
}

function compareItems(a, b) {
  const getValue = SORT_VALUES[view.sortKey];
  const va = getValue(a), vb = getValue(b);
  let result = typeof va === 'number'
    ? va - vb
    : String(va).localeCompare(String(vb), 'th', { numeric: true });
  // ค่าเท่ากัน → เรียงตามกำหนดเสร็จ แล้วตามลำดับที่เพิ่ม
  if (result === 0) {
    result = (a.dueDate || '').localeCompare(b.dueDate || '') ||
             (a.createdAt || '').localeCompare(b.createdAt || '');
  }
  return result * view.sortDir;
}

// ตัวเลขสรุปด้านบน (คิดจากข้อมูลทั้งหมด ไม่ขึ้นกับตัวกรอง) — กดเพื่อกรองได้
function renderSummary(today) {
  const total = items.length;
  const notDone = items.filter(i => i.status !== 'done').length;
  const overdue = items.filter(i => isOverdue(i, today)).length;
  document.getElementById('summary').innerHTML = total === 0 ? '' : `
    <button type="button" class="chip" data-filter-status="all">ทั้งหมด <b>${total}</b></button>
    <button type="button" class="chip" data-filter-status="not_done">ยังไม่เสร็จ <b>${notDone}</b></button>
    <button type="button" class="chip ${overdue ? 'chip-danger' : ''}" data-filter-status="overdue">เลยกำหนด <b>${overdue}</b></button>`;
}

// รายชื่อผู้รับผิดชอบในตัวกรอง (ดึงจากข้อมูลจริง)
function renderOwnerOptions() {
  const select = document.getElementById('filter-owner');
  const owners = [...new Set(items.flatMap(i => splitList(i.owners)))]
    .sort((a, b) => a.localeCompare(b, 'th'));
  if (view.owner && !owners.includes(view.owner)) view.owner = '';
  select.innerHTML = '<option value="">ทุกคน</option>' +
    owners.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
  select.value = view.owner;
}

// หัวคอลัมน์ที่กดเรียงได้
function sortableHeader(key, label, extraClass) {
  const active = view.sortKey === key;
  const arrow = active ? (view.sortDir === 1 ? ' ▲' : ' ▼') : '';
  return `<th class="sortable ${active ? 'sorted' : ''} ${extraClass || ''}" data-sort="${key}"
             title="กดเพื่อเรียงลำดับ">${label}<span class="arrow">${arrow}</span></th>`;
}

// ข้อความใต้กำหนดเสร็จ
function dueNote(item, today) {
  if (item.status === 'done' || !item.dueDate) return '';
  const days = daysBetween(today, item.dueDate);
  if (days < 0) return `<div class="due-note overdue-text">เลยกำหนด ${-days} วัน</div>`;
  if (days === 0) return '<div class="due-note soon-text">ครบกำหนดวันนี้</div>';
  if (days <= 7) return `<div class="due-note soon-text">อีก ${days} วัน</div>`;
  return '';
}

function renderList() {
  const area = document.getElementById('list-area');
  const today = todayIso();

  renderSummary(today);
  renderOwnerOptions();
  renderMeetingNameSuggestions();

  if (items.length === 0) {
    area.innerHTML = '<p class="empty">ยังไม่มีรายการมติ — กด "+ เพิ่มรายการ" เพื่อเริ่ม</p>';
    return;
  }

  const shown = items.filter(i => matchesFilters(i, today)).sort(compareItems);

  if (shown.length === 0) {
    area.innerHTML = '<p class="empty">ไม่พบรายการที่ตรงกับตัวกรอง — ลองกด "ล้างตัวกรอง"</p>';
    return;
  }

  const rows = shown.map(item => `
    <tr class="${isOverdue(item, today) ? 'row-overdue' : ''}">
      <td>
        <div class="strong">${escapeHtml(item.meetingName)}</div>
        <div class="muted">ครั้งที่ ${escapeHtml(item.meetingNo)}</div>
      </td>
      <td class="nowrap">${formatThaiDate(item.meetingDate)}</td>
      <td>
        <div>${multiline(item.resolution)}</div>
        ${item.note ? `<div class="note">หมายเหตุ: ${multiline(item.note)}</div>` : ''}
      </td>
      <td>
        ${splitList(item.owners).map(escapeHtml).join('<br>')}
        ${item.emails ? `<div class="muted small">${splitList(item.emails).map(escapeHtml).join('<br>')}</div>` : ''}
      </td>
      <td class="nowrap">${formatThaiDate(item.dueDate)}${dueNote(item, today)}</td>
      <td>
        <span class="badge badge-${item.status}">${STATUS_LABELS[item.status] || item.status}</span>
        ${sentNote(item)}
      </td>
      <td class="nowrap">
        <div class="actions">
          <button type="button" class="btn btn-small btn-mail" data-action="draft" data-id="${item.id}">ร่างอีเมล</button>
          <button type="button" class="btn btn-small" data-action="edit" data-id="${item.id}">แก้ไข</button>
          <button type="button" class="btn btn-small btn-danger" data-action="delete" data-id="${item.id}">ลบ</button>
        </div>
      </td>
    </tr>`).join('');

  const filtered = shown.length !== items.length;
  area.innerHTML = `
    ${filtered ? `<p class="muted small result-count">แสดง ${shown.length} จาก ${items.length} รายการ</p>` : ''}
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            ${sortableHeader('meeting', 'การประชุม')}
            ${sortableHeader('meetingDate', 'วันที่ประชุม')}
            <th class="col-resolution">เรื่อง/มติ</th>
            ${sortableHeader('owners', 'ผู้รับผิดชอบ')}
            ${sortableHeader('dueDate', 'กำหนดเสร็จ')}
            ${sortableHeader('status', 'สถานะ')}
            <th>จัดการ</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// =====================================================================
// ตัวกรองและการเรียง
// =====================================================================

const filterStatus = document.getElementById('filter-status');
const filterOwner = document.getElementById('filter-owner');
const filterText = document.getElementById('filter-text');

filterStatus.addEventListener('change', () => { view.status = filterStatus.value; renderList(); });
filterOwner.addEventListener('change', () => { view.owner = filterOwner.value; renderList(); });
filterText.addEventListener('input', () => { view.text = filterText.value.trim(); renderList(); });

document.getElementById('btn-clear-filters').addEventListener('click', () => {
  view.status = 'all';
  view.owner = '';
  view.text = '';
  filterStatus.value = 'all';
  filterText.value = '';
  renderList();
});

// กดตัวเลขสรุป → กรองตามสถานะนั้น
document.getElementById('summary').addEventListener('click', event => {
  const chip = event.target.closest('[data-filter-status]');
  if (!chip) return;
  view.status = chip.dataset.filterStatus;
  filterStatus.value = view.status;
  renderList();
});

// กดหัวคอลัมน์ → เรียง (กดซ้ำ = สลับน้อยไปมาก/มากไปน้อย)
document.getElementById('list-area').addEventListener('click', event => {
  const th = event.target.closest('th[data-sort]');
  if (!th) return;
  const key = th.dataset.sort;
  if (view.sortKey === key) {
    view.sortDir = -view.sortDir;
  } else {
    view.sortKey = key;
    view.sortDir = 1;
  }
  renderList();
});

// เติมรายชื่อการประชุมที่เคยกรอก ให้เลือกได้ตอนพิมพ์
function renderMeetingNameSuggestions() {
  const names = [...new Set(items.map(i => i.meetingName))].sort((a, b) => a.localeCompare(b, 'th'));
  document.getElementById('meeting-names').innerHTML =
    names.map(n => `<option value="${escapeHtml(n)}"></option>`).join('');
}

// =====================================================================
// ฟอร์มเพิ่ม/แก้ไข
// =====================================================================

const dialog = document.getElementById('form-dialog');
const form = document.getElementById('item-form');
let editingId = null; // null = เพิ่มใหม่, มีค่า = กำลังแก้ไขรายการนั้น

function openForm(item) {
  form.reset();
  clearErrors();
  editingId = item ? item.id : null;
  document.getElementById('form-title').textContent = item ? 'แก้ไขรายการ' : 'เพิ่มรายการ';

  if (item) {
    for (const name of ['meetingName', 'meetingNo', 'meetingDate', 'resolution',
                        'owners', 'emails', 'dueDate', 'status', 'note']) {
      form.elements[name].value = item[name] || '';
    }
  } else {
    form.elements.status.value = 'not_started';
  }

  dialog.showModal();
  form.elements.meetingName.focus();
}

function closeForm() {
  dialog.close();
  editingId = null;
}

function clearErrors() {
  form.querySelectorAll('.field').forEach(f => f.classList.remove('has-error'));
  form.querySelectorAll('.error-msg').forEach(e => (e.textContent = ''));
}

function showError(fieldName, message) {
  const field = form.elements[fieldName].closest('.field');
  field.classList.add('has-error');
  field.querySelector('.error-msg').textContent = message;
}

// อ่านค่าจากฟอร์ม + ตรวจความถูกต้อง  คืนค่า null ถ้ามีข้อผิดพลาด
function readForm() {
  clearErrors();
  const v = name => form.elements[name].value.trim();

  const data = {
    meetingName: v('meetingName'),
    meetingNo: v('meetingNo'),
    meetingDate: v('meetingDate'),
    resolution: v('resolution'),
    owners: joinList(splitList(v('owners'))),
    emails: joinList(splitList(v('emails'))),
    dueDate: v('dueDate'),
    status: v('status'),
    note: v('note'),
  };

  const problems = validateItem(data);
  if (problems.length) {
    problems.forEach(([name, msg]) => showError(name, msg));
    // เลื่อนไปช่องแรกที่ผิด
    const first = form.querySelector('.has-error input, .has-error textarea, .has-error select');
    if (first) first.focus();
    return null;
  }
  return data;
}

// ตรวจข้อมูลหนึ่งรายการ — ใช้ร่วมกันทั้งฟอร์มและการนำเข้า Excel
// คืนค่ารายการปัญหา [[ชื่อช่อง, ข้อความ], ...]  (ว่าง = ถูกต้อง)
function validateItem(data) {
  const problems = [];
  const fail = (name, msg) => problems.push([name, msg]);

  if (!data.meetingName) fail('meetingName', 'กรุณากรอกชื่อการประชุม');
  if (!data.meetingNo) fail('meetingNo', 'กรุณากรอกครั้งที่');
  if (!data.meetingDate) fail('meetingDate', 'กรุณาเลือกวันที่ประชุม');
  if (!data.resolution) fail('resolution', 'กรุณากรอกเรื่อง/มติ');
  if (!data.owners) fail('owners', 'กรุณากรอกผู้รับผิดชอบอย่างน้อย 1 คน');
  if (!data.dueDate) fail('dueDate', 'กรุณาเลือกกำหนดเสร็จ');
  if (data.meetingDate && data.dueDate && data.dueDate < data.meetingDate) {
    fail('dueDate', 'กำหนดเสร็จต้องไม่ก่อนวันที่ประชุม');
  }

  const badEmails = splitList(data.emails).filter(e => !isValidEmail(e));
  if (badEmails.length) fail('emails', 'รูปแบบอีเมลไม่ถูกต้อง: ' + badEmails.join(', '));

  if (!STATUS_LABELS[data.status]) fail('status', 'กรุณาเลือกสถานะ');
  return problems;
}

form.addEventListener('submit', event => {
  event.preventDefault();
  const data = readForm();
  if (!data) return;

  const now = new Date().toISOString();
  if (editingId) {
    const item = items.find(i => i.id === editingId);
    Object.assign(item, data, { updatedAt: now });
  } else {
    items.push({ id: newId(), ...data, sentDates: [], createdAt: now, updatedAt: now });
  }

  if (saveItems()) {
    closeForm();
    renderList();
  }
});

document.getElementById('btn-cancel').addEventListener('click', closeForm);
document.getElementById('btn-add').addEventListener('click', () => openForm(null));

// =====================================================================
// ปุ่มในตาราง (แก้ไข / ลบ)
// =====================================================================

document.getElementById('list-area').addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const item = items.find(i => i.id === button.dataset.id);
  if (!item) return;

  if (button.dataset.action === 'draft') {
    openDraft(item);
  } else if (button.dataset.action === 'edit') {
    openForm(item);
  } else if (button.dataset.action === 'delete') {
    const preview = item.resolution.length > 80 ? item.resolution.slice(0, 80) + '...' : item.resolution;
    const message = 'ต้องการลบรายการนี้ใช่หรือไม่?\n\n' +
      item.meetingName + ' ครั้งที่ ' + item.meetingNo + '\n' + preview +
      '\n\nลบแล้วกู้คืนไม่ได้ (ยกเว้นนำเข้าจากไฟล์ Excel ที่สำรองไว้)';
    if (confirm(message)) {
      items = items.filter(i => i.id !== item.id);
      saveItems();
      renderList();
    }
  }
});

// =====================================================================
// ตั้งค่าผู้ส่งอีเมล
// =====================================================================

const SETTINGS_KEY = 'meetingTracker.settings';
const SETTINGS_FIELDS = ['senderName', 'senderPosition', 'senderOrg', 'senderContact'];

function loadSettings() {
  try {
    return { senderOrg: 'สำนักวิชาการ', ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch (err) {
    return { senderOrg: 'สำนักวิชาการ' };
  }
}

let settings = loadSettings();

const settingsDialog = document.getElementById('settings-dialog');
const settingsForm = document.getElementById('settings-form');

function openSettings() {
  for (const name of SETTINGS_FIELDS) settingsForm.elements[name].value = settings[name] || '';
  settingsDialog.showModal();
}

settingsForm.addEventListener('submit', event => {
  event.preventDefault();
  const next = {};
  for (const name of SETTINGS_FIELDS) next[name] = settingsForm.elements[name].value.trim();
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch (err) {
    alert('บันทึกการตั้งค่าไม่สำเร็จ: ' + err.message);
    return;
  }
  settings = next;
  settingsDialog.close();
  // ถ้าเปิดร่างอีเมลค้างอยู่ ให้สร้างร่างใหม่ด้วยข้อมูลผู้ส่งล่าสุด
  if (draftItemId) fillDraft(items.find(i => i.id === draftItemId));
});

document.getElementById('btn-settings').addEventListener('click', openSettings);
document.getElementById('btn-settings-cancel').addEventListener('click', () => settingsDialog.close());

// =====================================================================
// ร่างอีเมล
// =====================================================================

// ["คุณ ก", "คุณ ข", "คุณ ค"] → "คุณ ก, คุณ ข และคุณ ค"
// (ใช้จุลภาคคั่น เพราะชื่อมีช่องว่างระหว่างชื่อ-นามสกุลอยู่แล้ว)
function joinThaiNames(names) {
  if (names.length <= 1) return names[0] || '';
  return names.slice(0, -1).join(', ') + ' และ' + names[names.length - 1];
}

// ทำให้ชื่อการประชุมขึ้นต้นด้วย "ที่ประชุม" เสมอ
// "คณะกรรมการวิชาการ" → "ที่ประชุมคณะกรรมการวิชาการ", "ที่ประชุมคณบดี" → คงเดิม
function meetingBodyName(name) {
  if (name.startsWith('ที่ประชุม')) return name;
  return 'ที่ประชุม' + name.replace(/^การประชุม/, '');
}

// สร้างร่างอีเมลจากข้อมูลรายการ → { to, subject, body }
function buildDraft(item, today) {
  const meeting = meetingBodyName(item.meetingName);
  const org = settings.senderOrg || '';
  const overdue = isOverdue(item, today);

  const subject = `ขอติดตามความคืบหน้าการดำเนินงานตามมติ${meeting} ครั้งที่ ${item.meetingNo}`;

  // มติหลายบรรทัด: ย่อหน้าทุกบรรทัด
  const resolution = item.resolution.split('\n').map(line => '        ' + line.trim()).join('\n');

  const request = overdue
    ? `เนื่องจากขณะนี้ได้ครบกำหนดระยะเวลาดังกล่าวแล้ว ${org}จึงใคร่ขอความอนุเคราะห์ท่านโปรดแจ้งผลหรือความคืบหน้าการดำเนินงาน หากมีข้อขัดข้องประการใด ขอได้โปรดแจ้งให้ทราบ เพื่อจะได้ประสานงานและรายงานต่อที่ประชุมต่อไป`
    : `${org}จึงใคร่ขอความอนุเคราะห์ท่านโปรดแจ้งความคืบหน้าการดำเนินงานดังกล่าว เพื่อจะได้รวบรวมและรายงานต่อที่ประชุมต่อไป`;

  const signature = [
    settings.senderName || '(ชื่อผู้ส่ง)',
    settings.senderPosition,
    settings.senderOrg,
    settings.senderContact,
  ].filter(Boolean).join('\n');

  const body =
`เรียน ${joinThaiNames(splitList(item.owners))}

        ตามที่${meeting} ครั้งที่ ${item.meetingNo} เมื่อวันที่ ${formatThaiDateLong(item.meetingDate)} ได้มีมติในเรื่อง ดังนี้

${resolution}

โดยมอบหมายให้ท่านเป็นผู้รับผิดชอบ และกำหนดให้ดำเนินการแล้วเสร็จภายในวันที่ ${formatThaiDateLong(item.dueDate)} นั้น

        ${request.replace(/\s+/g, ' ').trim()}

        จึงเรียนมาเพื่อโปรดพิจารณา

ขอแสดงความนับถือ

${signature}`;

  // ใช้ ; คั่นผู้รับ — วางได้ทั้งใน Outlook และ Gmail
  return { to: splitList(item.emails).join('; '), subject, body };
}

const draftDialog = document.getElementById('draft-dialog');
let draftItemId = null;

function openDraft(item) {
  draftItemId = item.id;
  fillDraft(item);
  document.getElementById('sent-date').value = todayIso();
  document.getElementById('sent-date').max = todayIso();
  document.getElementById('sent-msg').textContent = '';
  renderSentHistory(item);
  draftDialog.showModal();
}

function fillDraft(item) {
  const today = todayIso();
  const draft = buildDraft(item, today);
  document.getElementById('draft-to').value = draft.to;
  document.getElementById('draft-subject').value = draft.subject;
  document.getElementById('draft-body').value = draft.body;
  document.getElementById('draft-context').textContent =
    `${item.meetingName} ครั้งที่ ${item.meetingNo} · กำหนดเสร็จ ${formatThaiDate(item.dueDate)}` +
    (isOverdue(item, today) ? ' · เลยกำหนดแล้ว (ใช้ข้อความแบบติดตามงานที่เลยกำหนด)' : '');

  const warnings = [];
  if (!item.emails) warnings.push('รายการนี้ยังไม่มีอีเมลผู้รับ — พิมพ์ในช่องผู้รับได้เลย หรือกด "แก้ไข" ในตารางเพื่อบันทึกอีเมลไว้');
  if (!settings.senderName) warnings.push('ยังไม่ได้ตั้งชื่อผู้ส่ง — กด "ตั้งค่าผู้ส่งอีเมล" ด้านบน ลายเซ็นจะได้ครบ');
  if (item.status === 'done') warnings.push('รายการนี้มีสถานะ "เสร็จแล้ว"');
  const warnEl = document.getElementById('draft-warning');
  warnEl.innerHTML = warnings.map(escapeHtml).join('<br>');
  warnEl.hidden = warnings.length === 0;
}

function closeDraft() {
  draftDialog.close();
  draftItemId = null;
}

document.getElementById('btn-draft-close').addEventListener('click', closeDraft);
draftDialog.addEventListener('close', () => { draftItemId = null; });

document.getElementById('btn-draft-reset').addEventListener('click', () => {
  if (!confirm('ข้อความที่แก้ไว้จะหายไป และกลับเป็นร่างเริ่มต้น ต้องการทำต่อหรือไม่?')) return;
  fillDraft(items.find(i => i.id === draftItemId));
});

// ===== ปุ่มคัดลอก =====

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    // วิธีสำรอง สำหรับ browser ที่ไม่อนุญาต clipboard API
    const temp = document.createElement('textarea');
    temp.value = text;
    temp.style.position = 'fixed';
    temp.style.opacity = '0';
    draftDialog.appendChild(temp);
    temp.select();
    const ok = document.execCommand('copy');
    temp.remove();
    return ok;
  }
}

draftDialog.addEventListener('click', async event => {
  const button = event.target.closest('.btn-copy');
  if (!button) return;
  const text = document.getElementById(button.dataset.copy).value;
  if (!text.trim()) {
    flashButton(button, 'ไม่มีข้อความ', false);
    return;
  }
  const ok = await copyText(text);
  flashButton(button, ok ? 'คัดลอกแล้ว ✓' : 'คัดลอกไม่สำเร็จ', ok);
});

// เปลี่ยนข้อความปุ่มชั่วคราว แล้วกลับเป็นข้อความเดิม
function flashButton(button, message, ok) {
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.textContent = message;
  button.classList.toggle('copied', ok);
  button.classList.toggle('copy-failed', !ok);
  clearTimeout(button._timer);
  button._timer = setTimeout(() => {
    button.textContent = button.dataset.label;
    button.classList.remove('copied', 'copy-failed');
  }, 1800);
}

// ===== บันทึกว่าส่งแล้ว =====

// ข้อความใต้สถานะในตาราง
function sentNote(item) {
  const dates = item.sentDates || [];
  if (dates.length === 0) return '';
  const last = dates[dates.length - 1];
  const times = dates.length > 1 ? ` (${dates.length} ครั้ง)` : '';
  return `<div class="sent-note">ส่งอีเมลล่าสุด ${formatThaiDate(last)}${times}</div>`;
}

function renderSentHistory(item) {
  const dates = item.sentDates || [];
  const el = document.getElementById('sent-history');
  if (dates.length === 0) {
    el.innerHTML = '<p class="muted small">ยังไม่เคยบันทึกการส่งอีเมลสำหรับรายการนี้</p>';
    return;
  }
  el.innerHTML = `
    <p class="small strong">ประวัติการส่ง (${dates.length} ครั้ง)</p>
    <ul class="sent-list">
      ${dates.map((d, index) => `
        <li>${formatThaiDateLong(d)}
          <button type="button" class="link-danger" data-remove-sent="${index}" title="ลบวันที่นี้">ลบ</button>
        </li>`).join('')}
    </ul>`;
}

document.getElementById('btn-mark-sent').addEventListener('click', () => {
  const item = items.find(i => i.id === draftItemId);
  if (!item) return;
  const date = document.getElementById('sent-date').value;
  const msg = document.getElementById('sent-msg');

  if (!date) { msg.textContent = 'กรุณาเลือกวันที่ส่ง'; msg.className = 'sent-msg error'; return; }
  if (date > todayIso()) { msg.textContent = 'วันที่ส่งต้องไม่เกินวันนี้'; msg.className = 'sent-msg error'; return; }

  item.sentDates = item.sentDates || [];
  if (item.sentDates.includes(date)) {
    msg.textContent = 'วันที่นี้บันทึกไว้แล้ว';
    msg.className = 'sent-msg error';
    return;
  }
  item.sentDates.push(date);
  item.sentDates.sort();
  item.updatedAt = new Date().toISOString();

  if (saveItems()) {
    msg.textContent = 'บันทึกแล้ว: ส่งเมื่อ ' + formatThaiDate(date);
    msg.className = 'sent-msg ok';
    renderSentHistory(item);
    renderList();
  }
});

// ลบวันที่ส่งที่บันทึกผิด
document.getElementById('sent-history').addEventListener('click', event => {
  const button = event.target.closest('[data-remove-sent]');
  if (!button) return;
  const item = items.find(i => i.id === draftItemId);
  const index = Number(button.dataset.removeSent);
  const date = item.sentDates[index];
  if (!confirm('ลบวันที่ส่ง ' + formatThaiDateLong(date) + ' ออกจากประวัติ?')) return;
  item.sentDates.splice(index, 1);
  item.updatedAt = new Date().toISOString();
  if (saveItems()) {
    document.getElementById('sent-msg').textContent = '';
    renderSentHistory(item);
    renderList();
  }
});

// =====================================================================
// Excel: ส่งออก / นำเข้า
// =====================================================================

// คอลัมน์ในไฟล์ Excel (ลำดับนี้ = ลำดับคอลัมน์ในไฟล์)
// type: 'date' = เซลล์วันที่, 'dateList' = หลายวันที่คั่นจุลภาค, 'status' = แปลงเป็นข้อความไทย
const EXCEL_COLUMNS = [
  { key: 'id',          label: 'รหัส',          width: 16 },
  { key: 'meetingName', label: 'ชื่อการประชุม',   width: 28, required: true },
  { key: 'meetingNo',   label: 'ครั้งที่',        width: 10, required: true },
  { key: 'meetingDate', label: 'วันที่ประชุม',    width: 13, required: true, type: 'date' },
  { key: 'resolution',  label: 'เรื่อง/มติ',      width: 50, required: true },
  { key: 'owners',      label: 'ผู้รับผิดชอบ',    width: 30, required: true },
  { key: 'emails',      label: 'อีเมล',          width: 35 },
  { key: 'dueDate',     label: 'กำหนดเสร็จ',     width: 13, required: true, type: 'date' },
  { key: 'status',      label: 'สถานะ',          width: 15, required: true, type: 'status' },
  { key: 'note',        label: 'หมายเหตุ',       width: 30 },
  { key: 'sentDates',   label: 'วันที่ส่งอีเมล',   width: 24, type: 'dateList' },
  { key: 'createdAt',   label: 'สร้างเมื่อ',       width: 22 },
  { key: 'updatedAt',   label: 'แก้ไขล่าสุด',     width: 22 },
];

const DATA_SHEET = 'มติประชุม';
const SETTINGS_SHEET = 'ตั้งค่าผู้ส่ง';
const SETTINGS_LABELS = {
  senderName: 'ชื่อผู้ส่ง',
  senderPosition: 'ตำแหน่ง',
  senderOrg: 'หน่วยงาน',
  senderContact: 'ช่องทางติดต่อ',
};
const EXCEL_DATE_FORMAT = 'dd/mm/yyyy';

// ----- แปลงวันที่ ระหว่างระบบกับ Excel -----
// Excel เก็บวันที่เป็นตัวเลข "จำนวนวันนับจาก 30 ธ.ค. 1899"
// คำนวณแบบ UTC ทั้งหมด เพื่อไม่ให้วันที่เลื่อนเพราะเขตเวลา
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

function isoToExcelSerial(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return (Date.UTC(y, m - 1, d) - EXCEL_EPOCH) / 86400000;
}

function makeIso(y, m, d) {
  if (y > 2400) y -= 543; // ปี พ.ศ. → ค.ศ.
  const date = new Date(Date.UTC(y, m - 1, d));
  // ตรวจว่าเป็นวันที่มีอยู่จริง (เช่น 31/02 ไม่ผ่าน)
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  if (y < 1990 || y > 2200) return null;
  const pad = n => String(n).padStart(2, '0');
  return y + '-' + pad(m) + '-' + pad(d);
}

// แปลงค่าจากเซลล์ Excel เป็น "ปปปป-ดด-วว"  คืน '' ถ้าว่าง, null ถ้าอ่านไม่ได้
// รับได้: เซลล์วันที่ของ Excel, "2026-11-10", "10/11/2026", "10/11/2569" (พ.ศ.)
function parseExcelDate(value) {
  if (value === '' || value === null || value === undefined) return '';
  if (value instanceof Date) {
    if (isNaN(value)) return null;
    // บวก 12 ชม. กันวันที่เลื่อน กรณีเวลาเป็นเที่ยงคืน UTC หรือเที่ยงคืนเวลาไทย
    const shifted = new Date(value.getTime() + 12 * 3600000);
    return makeIso(shifted.getFullYear(), shifted.getMonth() + 1, shifted.getDate());
  }
  if (typeof value === 'number') {
    const date = new Date(EXCEL_EPOCH + Math.floor(value) * 86400000);
    return makeIso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  const text = String(value).trim();
  if (text === '') return '';
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return makeIso(+m[1], +m[2], +m[3]);
  m = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (m) return makeIso(+m[3], +m[2], +m[1]);
  return null;
}

// "2026-11-10" → "10/11/2026" (ใช้กับคอลัมน์วันที่ส่งอีเมล ซึ่งเก็บเป็นข้อความ)
function isoToDmy(iso) {
  const [y, m, d] = iso.split('-');
  return d + '/' + m + '/' + y;
}

// ส่วนของชื่อไฟล์ เช่น "2569-11-10" หรือ "2569-11-10_0930"
function fileDateStamp(withTime) {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  let stamp = (now.getFullYear() + 543) + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  if (withTime) stamp += '_' + pad(now.getHours()) + pad(now.getMinutes());
  return stamp;
}

// ----- ส่งออก -----

function buildWorkbook(list) {
  const sorted = [...list].sort((a, b) =>
    a.meetingDate.localeCompare(b.meetingDate) || (a.createdAt || '').localeCompare(b.createdAt || ''));

  const rows = sorted.map(item => EXCEL_COLUMNS.map(col => {
    const value = item[col.key];
    if (col.type === 'date') return value ? isoToExcelSerial(value) : '';
    if (col.type === 'dateList') return (value || []).map(isoToDmy).join(', ');
    if (col.type === 'status') return STATUS_LABELS[value] || value;
    return value ?? '';
  }));

  const sheet = XLSX.utils.aoa_to_sheet([EXCEL_COLUMNS.map(c => c.label), ...rows]);

  // ให้คอลัมน์วันที่แสดงเป็นวันที่ (ไม่ใช่ตัวเลข)
  EXCEL_COLUMNS.forEach((col, c) => {
    if (col.type !== 'date') return;
    for (let r = 1; r <= rows.length; r++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.t === 'n') cell.z = EXCEL_DATE_FORMAT;
    }
  });
  sheet['!cols'] = EXCEL_COLUMNS.map(c => ({ wch: c.width }));

  const settingsSheet = XLSX.utils.aoa_to_sheet([
    ['รายการ', 'ค่า'],
    ...Object.entries(SETTINGS_LABELS).map(([key, label]) => [label, settings[key] || '']),
  ]);
  settingsSheet['!cols'] = [{ wch: 16 }, { wch: 40 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, DATA_SHEET);
  XLSX.utils.book_append_sheet(workbook, settingsSheet, SETTINGS_SHEET);
  return workbook;
}

// สร้างไฟล์ Excel และดาวน์โหลด  คืนชื่อไฟล์
function downloadWorkbook(list, filename) {
  XLSX.writeFile(buildWorkbook(list), filename, { compression: true });
  return filename;
}

function markExported() {
  localStorage.setItem(LAST_EXPORT_KEY, new Date().toISOString());
  renderBackupStatus();
}

document.getElementById('btn-export').addEventListener('click', () => {
  if (typeof XLSX === 'undefined') { alert('โหลดไลบรารี Excel ไม่สำเร็จ — ส่งออกไม่ได้'); return; }
  if (items.length === 0 && !confirm('ยังไม่มีรายการมติ ต้องการส่งออกไฟล์เปล่า (มีแต่หัวตาราง) หรือไม่?')) return;
  const name = downloadWorkbook(items, `มติประชุม_${fileDateStamp(false)}.xlsx`);
  markExported();
  showToast(`ส่งออกแล้ว ${items.length} รายการ → ${name} (อยู่ในโฟลเดอร์ Downloads)`);
});

// ----- นำเข้า -----

// อ่านไฟล์ Excel → { items, settings, errors }
function parseWorkbook(workbook) {
  const errors = [];
  const sheetName = workbook.SheetNames.includes(DATA_SHEET) ? DATA_SHEET : workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet || !sheet['!ref']) return { items: [], settings: null, errors: ['ไม่พบข้อมูลในไฟล์'] };

  const startRow = XLSX.utils.decode_range(sheet['!ref']).s.r; // แถวแรกของข้อมูล (เริ่มนับ 0)
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '', blankrows: true });

  // หาตำแหน่งคอลัมน์จากหัวตาราง
  const header = (rows[0] || []).map(h => String(h).trim());
  const colIndex = {};
  for (const col of EXCEL_COLUMNS) colIndex[col.key] = header.indexOf(col.label);
  const missing = EXCEL_COLUMNS.filter(c => c.required && colIndex[c.key] === -1).map(c => c.label);
  if (missing.length) {
    return {
      items: [], settings: null,
      errors: [`ไม่พบคอลัมน์: ${missing.join(', ')}`,
               'ไฟล์นี้อาจไม่ใช่ไฟล์ที่ส่งออกจากระบบนี้ หรือหัวตารางในแถวแรกถูกแก้ไข'],
    };
  }

  const statusByLabel = {};
  for (const [key, label] of Object.entries(STATUS_LABELS)) { statusByLabel[label] = key; statusByLabel[key] = key; }

  const LABEL_OF = Object.fromEntries(EXCEL_COLUMNS.map(c => [c.key, c.label]));
  const seenIds = new Set();
  const now = new Date().toISOString();
  const result = [];

  rows.slice(1).forEach((row, index) => {
    const rowNumber = startRow + index + 2; // เลขแถวตามที่เห็นใน Excel
    const get = key => (colIndex[key] === -1 ? '' : row[colIndex[key]]);
    const text = key => String(get(key) ?? '').replace(/\r\n?/g, '\n').trim();

    // ข้ามแถวว่าง
    if (row.every(cell => String(cell ?? '').trim() === '')) return;

    const rowErrors = [];
    const readDate = key => {
      const iso = parseExcelDate(get(key));
      if (iso === null) { rowErrors.push(`${LABEL_OF[key]} อ่านไม่ได้ ("${text(key)}") — ใช้รูปแบบ วว/ดด/ปปปป`); return ''; }
      return iso;
    };

    const statusText = text('status');
    const data = {
      meetingName: text('meetingName'),
      meetingNo: text('meetingNo'),
      meetingDate: readDate('meetingDate'),
      resolution: text('resolution'),
      owners: joinList(splitList(text('owners'))),
      emails: joinList(splitList(text('emails'))),
      dueDate: readDate('dueDate'),
      status: statusByLabel[statusText] || '',
      note: text('note'),
    };

    // วันที่ส่งอีเมล (หลายวัน คั่นด้วยจุลภาค)
    const sentDates = [];
    for (const part of splitList(text('sentDates'))) {
      const iso = parseExcelDate(part);
      if (!iso) rowErrors.push(`วันที่ส่งอีเมลอ่านไม่ได้ ("${part}")`);
      else if (iso > todayIso()) rowErrors.push(`วันที่ส่งอีเมลเป็นวันในอนาคต ("${part}")`);
      else sentDates.push(iso);
    }

    for (const [field, msg] of validateItem(data)) {
      if (field === 'status') {
        rowErrors.push(`สถานะ "${statusText}" ไม่ถูกต้อง — ใช้ได้เฉพาะ: ${Object.values(STATUS_LABELS).join(' / ')}`);
      } else if ((field === 'meetingDate' || field === 'dueDate') && rowErrors.some(e => e.startsWith(LABEL_OF[field]))) {
        // อ่านวันที่ไม่ได้ แจ้งไปแล้วด้านบน
      } else {
        rowErrors.push(msg);
      }
    }

    if (rowErrors.length) {
      rowErrors.forEach(e => errors.push(`แถว ${rowNumber}: ${e}`));
      return;
    }

    // รหัส: ใช้ของเดิมถ้ามี (และไม่ซ้ำ) ไม่อย่างนั้นสร้างใหม่
    let id = text('id');
    if (!id || seenIds.has(id)) id = newId();
    seenIds.add(id);

    const validTime = t => (t && !isNaN(Date.parse(t)) ? t : '');
    result.push({
      id,
      ...data,
      sentDates: [...new Set(sentDates)].sort(),
      createdAt: validTime(text('createdAt')) || now,
      updatedAt: validTime(text('updatedAt')) || now,
    });
  });

  // ตั้งค่าผู้ส่ง (ถ้ามีชีตนี้)
  let importedSettings = null;
  const sSheet = workbook.Sheets[SETTINGS_SHEET];
  if (sSheet) {
    const sRows = XLSX.utils.sheet_to_json(sSheet, { header: 1, raw: false, defval: '' });
    importedSettings = {};
    for (const [key, label] of Object.entries(SETTINGS_LABELS)) {
      const found = sRows.find(r => String(r[0]).trim() === label);
      importedSettings[key] = found ? String(found[1] ?? '').trim() : '';
    }
  }

  return { items: result, settings: importedSettings, errors };
}

const importInput = document.getElementById('import-file');

document.getElementById('btn-import').addEventListener('click', () => {
  if (typeof XLSX === 'undefined') { alert('โหลดไลบรารี Excel ไม่สำเร็จ — นำเข้าไม่ได้'); return; }
  importInput.value = ''; // ให้เลือกไฟล์เดิมซ้ำได้
  importInput.click();
});

importInput.addEventListener('change', () => {
  const file = importInput.files[0];
  if (file) importFromFile(file);
});

async function importFromFile(file) {
  let workbook;
  try {
    workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  } catch (err) {
    alert('เปิดไฟล์ไม่ได้ — กรุณาเลือกไฟล์ Excel (.xlsx)\n\n' + err.message);
    return;
  }

  const parsed = parseWorkbook(workbook);

  if (parsed.errors.length) {
    const shown = parsed.errors.slice(0, 15);
    const more = parsed.errors.length > shown.length ? `\n... และอีก ${parsed.errors.length - shown.length} จุด` : '';
    alert(`นำเข้าไม่ได้ เพราะพบปัญหาในไฟล์ "${file.name}" ${parsed.errors.length} จุด:\n\n` +
          shown.join('\n') + more +
          '\n\nกรุณาแก้ในไฟล์ Excel แล้วนำเข้าใหม่ (ข้อมูลปัจจุบันยังไม่ถูกเปลี่ยนแปลง)');
    return;
  }
  if (parsed.items.length === 0) {
    alert(`ไม่พบรายการมติในไฟล์ "${file.name}" (ข้อมูลปัจจุบันยังไม่ถูกเปลี่ยนแปลง)`);
    return;
  }

  const backupNote = items.length
    ? `\n\nก่อนแทนที่ ระบบจะดาวน์โหลดไฟล์สำรองข้อมูลปัจจุบัน (${items.length} รายการ) ให้อัตโนมัติ`
    : '';
  const ok = confirm(
    `นำเข้าจากไฟล์ "${file.name}"\n\n` +
    `• ข้อมูลปัจจุบัน ${items.length} รายการ จะถูกแทนที่ทั้งหมด\n` +
    `• ด้วยข้อมูลจากไฟล์ ${parsed.items.length} รายการ` +
    (parsed.settings ? '\n• รวมถึงการตั้งค่าผู้ส่งอีเมล' : '') +
    backupNote + '\n\nต้องการทำต่อหรือไม่?');
  if (!ok) return;

  // สำรองข้อมูลปัจจุบันก่อนแทนที่
  let backupName = '';
  if (items.length) {
    try {
      backupName = downloadWorkbook(items, `สำรองก่อนนำเข้า_${fileDateStamp(true)}.xlsx`);
    } catch (err) {
      alert('สร้างไฟล์สำรองไม่สำเร็จ จึงยกเลิกการนำเข้า (ข้อมูลปัจจุบันยังอยู่ครบ)\n\n' + err.message);
      return;
    }
  }

  const previousItems = items;
  items = parsed.items;
  if (!saveItems()) {
    items = previousItems;
    renderList();
    return;
  }
  if (parsed.settings) {
    settings = parsed.settings;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }
  markExported(); // ข้อมูลตอนนี้ตรงกับไฟล์ที่นำเข้า ถือว่ามีสำรองแล้ว
  renderList();
  showToast(`นำเข้าแล้ว ${items.length} รายการ` +
            (backupName ? ` · ไฟล์สำรองข้อมูลเดิม: ${backupName} (โฟลเดอร์ Downloads)` : ''));
}

// ----- สถานะการสำรองข้อมูล -----

const thaiTimeFormat = new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit' });

function renderBackupStatus() {
  const el = document.getElementById('backup-status');
  if (items.length === 0) { el.hidden = true; return; }

  const lastExport = localStorage.getItem(LAST_EXPORT_KEY);
  const lastChange = localStorage.getItem(LAST_CHANGE_KEY);
  el.hidden = false;

  if (!lastExport) {
    el.className = 'backup-status warn';
    el.textContent = 'ยังไม่เคยสำรองข้อมูล — กด "ส่งออก Excel" เพื่อเก็บไฟล์สำรองไว้ (ข้อมูลอยู่ใน browser นี้เท่านั้น)';
    return;
  }

  const exported = new Date(lastExport);
  const pad = n => String(n).padStart(2, '0');
  const exportedIso = exported.getFullYear() + '-' + pad(exported.getMonth() + 1) + '-' + pad(exported.getDate());
  const days = daysBetween(exportedIso, todayIso());
  const changedAfter = lastChange && lastChange > lastExport;

  let text = `สำรองข้อมูลล่าสุด ${formatThaiDate(exportedIso)} เวลา ${thaiTimeFormat.format(exported)} น.`;
  if (days > 0) text += ` (${days} วันที่แล้ว)`;
  if (changedAfter) text += ' · มีการแก้ไขหลังจากนั้น ควรส่งออกใหม่';

  el.className = 'backup-status ' + (changedAfter ? 'warn' : '');
  el.textContent = text;
}

// ----- ข้อความแจ้งชั่วคราวมุมล่าง -----

function showToast(message) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 6000);
}

// =====================================================================
// เริ่มทำงานเมื่อเปิดหน้า
// =====================================================================

function checkLibraries() {
  const statusEl = document.getElementById('status-text');
  if (typeof XLSX === 'undefined') {
    statusEl.innerHTML =
      '<span class="error">โหลดไลบรารี Excel ไม่สำเร็จ — ตรวจว่ามีไฟล์ lib/xlsx.full.min.js อยู่ในโฟลเดอร์</span>';
    return;
  }
  statusEl.textContent = 'พร้อมใช้งาน · ไลบรารี Excel (SheetJS) รุ่น ' + XLSX.version;
}

items = loadItems();
renderList();
renderBackupStatus();
checkLibraries();
