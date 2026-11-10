// ระบบติดตามมติที่ประชุม — โค้ดหลัก
// ข้อมูลทั้งหมดเก็บใน localStorage ของ browser (จะเริ่มใช้ในขั้นที่ 2)

'use strict';

// ===== ตรวจว่าโหลดไลบรารี Excel สำเร็จหรือไม่ =====
function checkLibraries() {
  const statusEl = document.getElementById('status-text');
  if (typeof XLSX === 'undefined') {
    statusEl.innerHTML =
      '<span class="error">โหลดไลบรารี Excel ไม่สำเร็จ — ตรวจว่ามีไฟล์ lib/xlsx.full.min.js อยู่ในโฟลเดอร์</span>';
    return;
  }
  statusEl.textContent = 'พร้อมใช้งาน · ไลบรารี Excel (SheetJS) รุ่น ' + XLSX.version;
}

// ===== เริ่มทำงานเมื่อเปิดหน้า =====
document.addEventListener('DOMContentLoaded', checkLibraries);
