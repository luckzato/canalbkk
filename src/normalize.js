import { STATIONS as CATALOG, DISTRICTS } from './catalog.js';
// แปลงข้อมูลดิบจาก API สำนักการระบายน้ำ กทม. ให้อยู่ในรูปที่หน้าเว็บใช้ง่าย
// Raw source: POST https://weather.bangkok.go.th/water/PageMap/GoogleMap

const STATUS_BY_PRIORITY = { 4: 'critical', 3: 'alert', 2: 'normal', 1: 'normal', 0: 'offline' };

const num = (v) => (v === null || v === undefined || v === '' || v === -99 || !Number.isFinite(+v) ? null : +v);

// บางสถานี (โดยเฉพาะของเครือข่ายอื่น) ส่งเกณฑ์มาเป็นหน่วยเซนติเมตรหรือค่าผิดปกติ เช่น 230/440
// ระดับน้ำในคลอง กทม. อยู่ในช่วงราว -5 ถึง +5 ม.รทก. จึงตัดค่าที่เกิน 10 ทิ้ง
const sane = (v) => (v !== null && Math.abs(v) < 10 ? v : null);

function parseTs(v) {
  if (typeof v === 'number') return v;
  const m = /\d{10,}/.exec(String(v || ''));
  return m ? +m[0] : null;
}

function kindOf(name) {
  if (/สถานีสูบน้ำ|บ่อสูบน้ำ/.test(name)) return 'pump';
  if (/ประตูระบายน้ำ|ปตร\./.test(name)) return 'gate';
  if (/^บึง|จุดวัดบึง|บึงรับน้ำ/.test(name)) return 'lake';
  return 'canal';
}

function deriveStatus(level, warn, crit) {
  if (level === null) return 'offline';
  if (crit !== null && level >= crit) return 'critical';
  if (warn !== null && level >= warn) return 'alert';
  return 'normal';
}

export function normalizeStation(r, now = Date.now()) {
  const level = num(r.wl_in);
  const warn = sane(num(r.warning));
  const crit = sane(num(r.critical));
  const left = sane(num(r.left_bank));
  const right = sane(num(r.right_bank));
  const banks = [left, right].filter((v) => v !== null);
  const bank = banks.length ? Math.min(...banks) : null; // ตลิ่งฝั่งที่ต่ำกว่าคือฝั่งที่น้ำจะล้นก่อน
  const ts = parseTs(r.site_timestamp);
  const ageMin = ts ? Math.max(0, Math.round((now - ts) / 60000)) : null;

  let status = STATUS_BY_PRIORITY[r.priorityStatus];
  if (!status) status = deriveStatus(level, warn, crit);
  if (r.status === 0 || level === null || (ageMin !== null && ageMin > 60)) status = 'offline';

  const name = String(r.water_name || '').trim();
  return {
    id: r.water_id,
    name: { th: name, en: String(r.water_name_en || '').trim() || name },
    district: {
      id: r.district_id,
      th: String(r.district_name || '').trim(),
      en: String(r.district_name_en || '').replace(/\s+/g, ' ').trim(),
    },
    kind: kindOf(name),
    lat: num(r.latitude),
    lng: num(r.longitude),
    ts,
    ageMin,
    status,
    level,
    levelOut: sane(num(r.wl_out01)),
    bank,
    warn,
    crit,
    warnOut: sane(num(r.warning_out01)),
    critOut: sane(num(r.critical_out01)),
    maxToday: sane(num(r.max_in_day)),
    maxYesterday: sane(num(r.max_in_yesterday)),
    freeboard: level !== null && bank !== null ? +(bank - level).toFixed(2) : null,
    partner: r.water_system_id === 3, // สถานีจากเครือข่ายภายนอก (ชื่อมี *) เช่น กรมชลประทาน
  };
}

export function normalize(rawList, now = Date.now()) {
  const stations = (Array.isArray(rawList) ? rawList : [])
    .filter((r) => r && r.latitude && r.longitude)
    .map((r) => normalizeStation(r, now));
  const counts = { critical: 0, alert: 0, normal: 0, offline: 0 };
  for (const s of stations) counts[s.status]++;
  // เวลาของรอบข้อมูล = เวลาที่สถานีส่วนใหญ่รายงาน (บางสถานีนาฬิกาเพี้ยน จึงไม่ใช้ค่าสูงสุด)
  const freq = new Map();
  for (const s of stations) if (s.ts && s.status !== 'offline') freq.set(s.ts, (freq.get(s.ts) || 0) + 1);
  const latest = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0];
  return {
    source: 'สำนักการระบายน้ำ กรุงเทพมหานคร (weather.bangkok.go.th/water)',
    credit: {
      th: 'ข้อมูล: สำนักการระบายน้ำ กรุงเทพมหานคร',
      en: 'Data: Drainage and Sewerage Department, Bangkok Metropolitan Administration',
      url: 'https://weather.bangkok.go.th/water/',
    },
    fetchedAt: now,
    dataTime: latest || null,
    counts,
    stations,
  };
}

// ---------- POPNIX Flood (flood.pop.in.th) ----------
// ส่งต่อข้อมูลของสำนักการระบายน้ำ กทม. อนุญาตให้นำไปใช้ได้โดยต้องให้เครดิต
// https://flood.pop.in.th/api/  ·  GET /api_overview.php

export const POPNIX_CREDIT = {
  th: 'ข้อมูล: สำนักการระบายน้ำ กรุงเทพมหานคร ผ่าน POPNIX Flood (flood.pop.in.th)',
  en: 'Data: Drainage and Sewerage Department, Bangkok Metropolitan Administration, via POPNIX Flood (flood.pop.in.th)',
  url: 'https://flood.pop.in.th',
};

// "2026-10-08 06:05:00" (เวลาไทย ไม่มี timezone) -> ms
function parseThai(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s || ''));
  return m ? Date.UTC(+m[1], m[2] - 1, +m[3], m[4] - 7, +m[5], +(m[6] || 0)) : null;
}

export function normalizePopnix(j, now = Date.now()) {
  const list = Array.isArray(j?.stations) ? j.stations : [];
  const stations = list.filter((p) => p && p.lat && p.lng).map((p) => {
    const c = CATALOG[p.id];
    const level = num(p.wl);
    const warn = sane(num(p.warn));
    const crit = sane(num(p.crit));
    const bank = sane(num(p.bank));
    const ts = parseThai(p.measured_at);
    const ageMin = ts ? Math.max(0, Math.round((now - ts) / 60000)) : null;
    let status = p.level === 'crit' ? 'critical' : p.level === 'warn' ? 'alert' : p.level === 'ok' ? 'normal' : deriveStatus(level, warn, crit);
    if (p.online === false || level === null || (ageMin !== null && ageMin > 60)) status = 'offline';
    const th = c ? c[0] : String(p.name || '').trim();
    const d = c ? DISTRICTS[c[2]] : null;
    return {
      id: p.id,
      name: { th, en: (c && c[1]) || th },
      district: { id: c ? c[2] : 0, th: d ? d[0] : '', en: d ? d[1].replace(/\s+/g, ' ') : '' },
      kind: c ? c[3] : kindOf(th),
      lat: num(p.lat),
      lng: num(p.lng),
      ts,
      ageMin,
      status,
      level,
      levelOut: null,
      bank,
      warn,
      crit,
      warnOut: null,
      critOut: null,
      maxToday: sane(num(p.max_day)),
      maxYesterday: sane(num(p.max_yday)),
      freeboard: level !== null && bank !== null ? +(bank - level).toFixed(2) : null,
      partner: c ? !!c[4] : false,
      trend: ['up', 'down', 'flat'].includes(p.trend) ? p.trend : null,
      delta: num(p.delta),
      deltaDay: num(p.delta_day),
      spark: Array.isArray(p.spark) ? p.spark.map(num) : null, // ~24 จุด ย้อนหลัง 6 ชม.
    };
  });
  const counts = { critical: 0, alert: 0, normal: 0, offline: 0 };
  for (const s of stations) counts[s.status]++;
  return {
    source: POPNIX_CREDIT.th,
    credit: POPNIX_CREDIT,
    fetchedAt: now,
    dataTime: parseThai(j?.summary?.latest) || null,
    stale: !!j?.summary?.stale,
    counts,
    stations,
  };
}
