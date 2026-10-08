// Vercel Serverless Function: GET /api/stations
// ใช้ตรรกะเดียวกับ Cloudflare Worker (ดึงจาก กทม. แล้ว normalize)
import { fetchUpstream } from '../src/worker.js';

export async function GET() {
  try {
    const data = await fetchUpstream();
    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        // แคชบน CDN ของ Vercel 60 วิ และถ้าต้นทางล่มให้ใช้ข้อมูลเก่าได้ถึง 24 ชม.
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=86400, stale-if-error=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'ดึงข้อมูลจาก กทม. ไม่สำเร็จ', detail: String(err.message) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
