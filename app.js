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

function renderList() {
  const area = document.getElementById('list-area');
  document.getElementById('count-text').textContent =
    items.length ? 'ทั้งหมด ' + items.length + ' รายการ' : '';

  if (items.length === 0) {
    area.innerHTML = '<p class="empty">ยังไม่มีรายการมติ — กด "+ เพิ่มรายการ" เพื่อเริ่ม</p>';
    renderMeetingNameSuggestions();
    return;
  }

  // เรียงตามกำหนดเสร็จ (ใกล้สุดก่อน) — ขั้นที่ 3 จะให้เลือกเรียงเองได้
  const sorted = [...items].sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const rows = sorted.map(item => `
    <tr>
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
      <td class="nowrap">${formatThaiDate(item.dueDate)}</td>
      <td><span class="badge badge-${item.status}">${STATUS_LABELS[item.status] || item.status}</span></td>
      <td class="nowrap actions">
        <button type="button" class="btn btn-small" data-action="edit" data-id="${item.id}">แก้ไข</button>
        <button type="button" class="btn btn-small btn-danger" data-action="delete" data-id="${item.id}">ลบ</button>
      </td>
    </tr>`).join('');

  area.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>การประชุม</th>
            <th>วันที่ประชุม</th>
            <th class="col-resolution">เรื่อง/มติ</th>
            <th>ผู้รับผิดชอบ</th>
            <th>กำหนดเสร็จ</th>
            <th>สถานะ</th>
            <th>จัดการ</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  renderMeetingNameSuggestions();
}

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

  if (button.dataset.action === 'edit') {
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
