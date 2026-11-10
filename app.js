// ระบบติดตามมติที่ประชุม — โค้ดหลัก
// ข้อมูลทั้งหมดเก็บใน localStorage ของ browser

'use strict';

// =====================================================================
// ค่าคงที่
// =====================================================================

// ชื่อที่ใช้เก็บข้อมูลใน localStorage (ห้ามเปลี่ยน ไม่อย่างนั้นข้อมูลเดิมจะหาไม่เจอ)
const STORAGE_KEY = 'meetingTracker.items';

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
//   sentDates,   // วันที่บันทึกว่าส่งอีเมลแล้ว (ใช้ในขั้นที่ 4) เช่น ["2026-11-10"]
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
  if (result === 0) result = a.dueDate.localeCompare(b.dueDate) || a.createdAt.localeCompare(b.createdAt);
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

  let ok = true;
  const fail = (name, msg) => { showError(name, msg); ok = false; };

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

  if (!ok) {
    // เลื่อนไปช่องแรกที่ผิด
    const first = form.querySelector('.has-error input, .has-error textarea, .has-error select');
    if (first) first.focus();
    return null;
  }
  return data;
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
checkLibraries();
