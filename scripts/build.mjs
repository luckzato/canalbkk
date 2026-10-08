// สร้าง public/index.html จาก src/app.html
// และสร้าง preview/preview.html (ฝังข้อมูลตัวอย่างจาก data/snapshot.json) สำหรับดูตัวอย่างแบบไม่ต้องมีเซิร์ฟเวอร์
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { normalize } from '../src/normalize.js';

const src = await readFile(new URL('../src/app.html', import.meta.url), 'utf8');
const [head, body] = src.split('<!--BODY-->');

const page = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="ระดับน้ำในคลองกรุงเทพฯ แบบเรียลไทม์ จากสถานีตรวจวัดของสำนักการระบายน้ำ กทม. ค้นหา กรองตามเขต และหาสถานีใกล้คุณ">
<meta name="theme-color" content="#0b7a83">
${head.trim()}
</head>
<body>
${body.trim()}
</body>
</html>
`;
await mkdir(new URL('../public/', import.meta.url), { recursive: true });
await writeFile(new URL('../public/index.html', import.meta.url), page);
console.log('✓ public/index.html');

// ----- preview -----
const snapUrl = new URL('../data/snapshot.json', import.meta.url);
if (existsSync(snapUrl)) {
  const snap = JSON.parse(await readFile(snapUrl, 'utf8'));
  // แปลงแถวแบบย่อกลับเป็นรูปแบบเดียวกับ API ต้นทาง แล้วผ่าน normalize ตัวเดียวกับ Worker
  const raw = snap.rows.map((r) => {
    const [id, sys, count, dist, th, en, adjust, lat, lng, tsMin, wlIn, wlOut, lb, rb, w, c, wo, co, maxD, maxY, status] = r;
    const d = snap.dist[dist] || ['', ''];
    return {
      water_id: id, water_system_id: sys, water_count: count, district_id: dist, district_name: d[0], district_name_en: d[1],
      water_name: th, water_name_en: en, adjust, latitude: lat, longitude: lng, site_timestamp: `/Date(${tsMin * 60000})/`,
      wl_in: wlIn, wl_out01: wlOut, left_bank: lb, right_bank: rb, warning: w, critical: c, warning_out01: wo, critical_out01: co,
      max_in_day: maxD, max_in_yesterday: maxY, status, priorityStatus: snap.priority[id],
    };
  });
  const data = normalize(raw, snap.capturedAt);
  const preview = `${head.trim()}\n<script>window.__SNAPSHOT__=${JSON.stringify(data)};</script>\n${body.trim()}\n`;
  await mkdir(new URL('../preview/', import.meta.url), { recursive: true });
  await writeFile(new URL('../preview/preview.html', import.meta.url), preview);
  await writeFile(new URL('../preview/sample-api-response.json', import.meta.url), JSON.stringify(data, null, 1));
  console.log('✓ preview/preview.html', data.counts);
}
