// Cloudflare Worker: เสิร์ฟหน้าเว็บ (public/) + API /api/stations ที่ดึงจาก กทม. แล้วแคชไว้
import { normalize, normalizePopnix } from './normalize.js';

// แหล่งหลัก: POPNIX Flood ส่งต่อข้อมูล กทม. เปิดให้เซิร์ฟเวอร์ดึงได้ (ต้องให้เครดิต)
// เว็บ กทม. โดยตรงใช้ Cloudflare กันบอท บล็อกเซิร์ฟเวอร์ใน data center จึงเป็นแหล่งสำรองเท่านั้น
const POPNIX = 'https://flood.pop.in.th/api_overview.php';
const UPSTREAM = 'https://weather.bangkok.go.th/water/PageMap/GoogleMap';
const FRESH_SECONDS = 60; // ข้อมูลต้นทางอัปเดตทุก ~5 นาที แคช 60 วินาทีพอ
const STALE_SECONDS = 60 * 60 * 24; // ถ้าต้นทางล่ม ใช้ข้อมูลล่าสุดที่เคยดึงได้ไม่เกิน 24 ชม.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function json(body, { status = 200, maxAge = FRESH_SECONDS, extra = {} } = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${maxAge}`,
      ...CORS,
      ...extra,
    },
  });
}

async function fetchPopnix(fetchImpl) {
  const res = await fetchImpl(POPNIX, {
    headers: { Accept: 'application/json', 'User-Agent': 'canalbkk/1.0 (+https://canalbkk.vercel.app)' },
  });
  if (!res.ok) throw new Error(`POPNIX HTTP ${res.status}`);
  const data = normalizePopnix(await res.json());
  if (!data.stations.length) throw new Error('POPNIX returned no stations');
  return data;
}

async function fetchBma(fetchImpl) {
  const res = await fetchImpl(UPSTREAM, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json, text/javascript, */*; q=0.01',
      Referer: 'https://weather.bangkok.go.th/water/',
      'User-Agent': 'canalbkk/1.0 (+https://canalbkk.vercel.app)',
    },
    body: 'payload=TEST_DATA_GOES_HERE',
  });
  if (!res.ok) {
    const h = (k) => res.headers.get(k) || '-';
    throw new Error(`BMA HTTP ${res.status} (server=${h('server')} cf-mitigated=${h('cf-mitigated')})`);
  }
  const raw = await res.json();
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('BMA returned no stations');
  return normalize(raw);
}

// ลอง POPNIX ก่อน ถ้าไม่ได้ค่อยลองเว็บ กทม. ตรง
export async function fetchUpstream(fetchImpl = fetch) {
  const errors = [];
  for (const fn of [fetchPopnix, fetchBma]) {
    try { return await fn(fetchImpl); } catch (e) { errors.push(e.message); }
  }
  throw new Error(errors.join(' · '));
}

async function handleStations(request, ctx) {
  const cache = caches.default;
  const origin = new URL(request.url).origin;
  const freshKey = new Request(`${origin}/__cache/stations`);
  const staleKey = new Request(`${origin}/__cache/stations-stale`);

  const hit = await cache.match(freshKey);
  if (hit) return json(await hit.text(), { extra: { 'X-Cache': 'HIT' } });

  try {
    const data = await fetchUpstream();
    const body = JSON.stringify(data);
    ctx.waitUntil(
      Promise.all([
        cache.put(freshKey, json(body, { maxAge: FRESH_SECONDS })),
        cache.put(staleKey, json(body, { maxAge: STALE_SECONDS })),
      ]),
    );
    return json(body, { extra: { 'X-Cache': 'MISS' } });
  } catch (err) {
    const stale = await cache.match(staleKey);
    if (stale) {
      return json(await stale.text(), { maxAge: 30, extra: { 'X-Cache': 'STALE', 'X-Upstream-Error': String(err.message) } });
    }
    return json({ error: 'ดึงข้อมูลจาก กทม. ไม่สำเร็จ', detail: String(err.message) }, { status: 502, maxAge: 0 });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (url.pathname === '/api/stations') return handleStations(request, ctx);
    if (url.pathname.startsWith('/api/')) return json({ error: 'not found' }, { status: 404, maxAge: 0 });
    return env.ASSETS.fetch(request);
  },
};
