// Google Apps Script สำหรับส่งเมลแจ้งเตือนจากเว็บคัดกรองสุขภาพ
// วิธีตั้งค่า
// 1. เปิด script.google.com แล้วสร้างโปรเจกต์ใหม่ วางโค้ดนี้
// 2. ตั้งค่ารหัสยืนยัน: Project Settings > Script Properties > เพิ่ม ALERT_TOKEN = รหัสที่คุณเลือกเอง
// 3. Deploy > New deployment > Web app > Execute as: Me > Who has access: Anyone
// 4. คัดลอก URL ที่ได้ (ลงท้ายด้วย /exec) ไปวางในหน้าผู้ดูแลระบบ พร้อมรหัสยืนยันเดียวกัน

function doPost(e) {
  const expected = PropertiesService.getScriptProperties().getProperty('ALERT_TOKEN');
  const data = JSON.parse(e.postData.contents);

  if (!expected || data.token !== expected) {
    return ContentService.createTextOutput('unauthorized');
  }
  if (!data.to || !data.subject || !data.body) {
    return ContentService.createTextOutput('bad request');
  }
  MailApp.sendEmail(data.to, data.subject, data.body);
  return ContentService.createTextOutput('ok');
}
