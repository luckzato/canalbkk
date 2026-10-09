// Vercel Function: POST /api/presence  {id, load}
// นับคนที่กำลังเปิดเว็บอยู่ + ยอดเข้าชมรายวัน (ดู src/analytics.js)
import { getStore, ping, validId } from '../src/analytics.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

export async function POST(request) {
  const store = getStore(process.env);
  if (!store.configured) return json({ configured: false, online: null });
  let body = {};
  try { body = await request.json(); } catch {}
  if (!validId(body.id)) return json({ error: 'invalid id' }, 400);
  try {
    return json({ configured: true, ...(await ping(store, body.id, !!body.load)) });
  } catch (err) {
    return json({ configured: true, online: null, error: String(err.message) }, 502);
  }
}
