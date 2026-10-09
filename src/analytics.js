// นับคนเข้าเว็บแบบเรียลไทม์ (ไม่ใช้คุกกี้ ไม่เก็บ IP หรือข้อมูลส่วนตัว)
// - "กำลังดูอยู่": เบราว์เซอร์ส่ง heartbeat ทุก 60 วิ ใครเงียบเกิน 2 นาทีถือว่าออกแล้ว
// - ยอดเปิดหน้า (page views) และผู้เข้าชมไม่ซ้ำ (unique visitors) รายวัน ตามเวลาไทย
// เก็บข้อมูลใน Upstash Redis ผ่าน REST API (ไม่ต้องติดตั้งแพ็กเกจ) ถ้าไม่ได้ตั้งค่าจะใช้หน่วยความจำแทน (สำหรับทดสอบบนเครื่อง)

const ONLINE_WINDOW_MS = 2 * 60 * 1000;
const KEEP_SECONDS = 60 * 60 * 24 * 45; // เก็บสถิติรายวัน 45 วัน
const K = { online: 'cb:online', pv: (d) => `cb:pv:${d}`, uv: (d) => `cb:uv:${d}` };

export const validId = (id) => typeof id === 'string' && /^[a-z0-9]{8,40}$/.test(id);

// วันที่ตามเวลาไทย เช่น 20261009
export function thaiDay(ms = Date.now(), offsetDays = 0) {
  const d = new Date(ms + 7 * 3600e3 - offsetDays * 864e5);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

/* ---------- storage ---------- */
function upstash(url, token) {
  return {
    configured: true,
    async pipeline(cmds) {
      const res = await fetch(`${url.replace(/\/$/, '')}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(cmds),
      });
      if (!res.ok) throw new Error(`Redis HTTP ${res.status}`);
      const out = await res.json();
      return out.map((r) => { if (r.error) throw new Error(r.error); return r.result; });
    },
  };
}

// จำลองคำสั่ง Redis ที่ใช้ เพื่อให้รันบนเครื่องได้โดยไม่ต้องมีฐานข้อมูล
function memory() {
  const z = new Map(), str = new Map(), sets = new Map();
  const run = ([cmd, key, ...a]) => {
    switch (cmd) {
      case 'ZADD': { const m = z.get(key) || new Map(); m.set(a[1], +a[0]); z.set(key, m); return 1; }
      case 'ZREMRANGEBYSCORE': { const m = z.get(key); if (!m) return 0; let n = 0; for (const [k, v] of m) if (v >= +a[0] && v <= +a[1]) { m.delete(k); n++; } return n; }
      case 'ZCARD': return z.get(key)?.size || 0;
      case 'INCR': { const v = (+str.get(key) || 0) + 1; str.set(key, String(v)); return v; }
      case 'GET': return str.get(key) ?? null;
      case 'PFADD': { const s = sets.get(key) || new Set(); const before = s.size; s.add(a[0]); sets.set(key, s); return s.size > before ? 1 : 0; }
      case 'PFCOUNT': return sets.get(key)?.size || 0;
      case 'EXPIRE': return 1;
      default: throw new Error(`unsupported ${cmd}`);
    }
  };
  return { configured: true, memory: true, async pipeline(cmds) { return cmds.map(run); } };
}

let memStore;
export function getStore(env = {}) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return upstash(url, token);
  if (env.ALLOW_MEMORY_STATS) return (memStore ||= memory());
  return { configured: false };
}

/* ---------- operations ---------- */
// load = true เมื่อเปิดหน้าครั้งแรก (นับ page view + unique visitor), false = heartbeat ระหว่างเปิดอยู่
export async function ping(store, id, load, now = Date.now()) {
  const day = thaiDay(now);
  const cmds = [
    ['ZADD', K.online, String(now), id],
    ['ZREMRANGEBYSCORE', K.online, '0', String(now - ONLINE_WINDOW_MS)],
    ['ZCARD', K.online],
  ];
  if (load) {
    cmds.push(['INCR', K.pv(day)], ['PFADD', K.uv(day), id], ['EXPIRE', K.pv(day), String(KEEP_SECONDS)], ['EXPIRE', K.uv(day), String(KEEP_SECONDS)]);
  }
  const r = await store.pipeline(cmds);
  return { online: r[2] };
}

export async function stats(store, days = 14, now = Date.now()) {
  const list = Array.from({ length: days }, (_, i) => thaiDay(now, days - 1 - i));
  const cmds = [
    ['ZREMRANGEBYSCORE', K.online, '0', String(now - ONLINE_WINDOW_MS)],
    ['ZCARD', K.online],
    ...list.flatMap((d) => [['GET', K.pv(d)], ['PFCOUNT', K.uv(d)]]),
  ];
  const r = await store.pipeline(cmds);
  const daily = list.map((d, i) => ({ date: d, pv: +(r[2 + i * 2] || 0), uv: +(r[3 + i * 2] || 0) }));
  return { online: r[1], today: daily.at(-1), daily, generatedAt: now, memory: !!store.memory };
}
