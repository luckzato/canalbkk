// Vercel Serverless Function: GET /api/rain (ปริมาณฝนจากสถานีวัดน้ำฝน)
import { fetchRain } from '../src/worker.js';

export async function GET() {
  try {
    return new Response(JSON.stringify(await fetchRain()), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=3600, stale-if-error=3600',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'ดึงข้อมูลฝนไม่สำเร็จ', detail: String(err.message) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
