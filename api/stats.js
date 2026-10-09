// Vercel Function: GET /api/stats  (ต้องส่งรหัสผ่าน header "x-stats-key" ให้ตรงกับ STATS_KEY)
import { getStore, stats } from '../src/analytics.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

export async function GET(request) {
  const key = process.env.STATS_KEY;
  if (!key) return json({ error: 'ยังไม่ได้ตั้งค่า STATS_KEY ใน Vercel' }, 503);
  if (request.headers.get('x-stats-key') !== key) return json({ error: 'รหัสไม่ถูกต้อง' }, 401);
  const store = getStore(process.env);
  if (!store.configured) return json({ error: 'ยังไม่ได้เชื่อม Upstash Redis กับโปรเจกต์' }, 503);
  try {
    const days = Math.min(45, Math.max(1, +new URL(request.url).searchParams.get('days') || 14));
    return json(await stats(store, days));
  } catch (err) {
    return json({ error: String(err.message) }, 502);
  }
}
