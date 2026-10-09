// เซิร์ฟเวอร์สำหรับรันบนเครื่องตัวเอง (ไม่ต้องมี Cloudflare): node scripts/dev.mjs
// เสิร์ฟ public/ และ /api/stations ด้วยตรรกะเดียวกับ Worker
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize as normPath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchUpstream, fetchRain } from '../src/worker.js';
import { getStore, ping, stats, validId } from '../src/analytics.js';

// บนเครื่องใช้หน่วยความจำแทน Redis ถ้าไม่ได้ตั้ง KV_REST_API_URL / KV_REST_API_TOKEN
const statsStore = getStore({ ...process.env, ALLOW_MEMORY_STATS: 1 });
const STATS_KEY = process.env.STATS_KEY || 'dev';
const readBody = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { try { ok(JSON.parse(b)); } catch { ok({}); } }); });

const root = fileURLToPath(new URL('../public/', import.meta.url));
const PORT = process.env.PORT || 8787;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

let cache = { at: 0, body: null };
let rainCache = { at: 0, body: null };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/api/presence' && req.method === 'POST') {
      const body = await readBody(req);
      res.writeHead(validId(body.id) ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(validId(body.id) ? { configured: true, ...(await ping(statsStore, body.id, !!body.load)) } : { error: 'invalid id' }));
    }
    if (url.pathname === '/api/stats') {
      if (req.headers['x-stats-key'] !== STATS_KEY) { res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'รหัสไม่ถูกต้อง' })); }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(await stats(statsStore, Math.min(45, +url.searchParams.get('days') || 14))));
    }
    if (url.pathname === '/api/rain') {
      try {
        if (!rainCache.body || Date.now() - rainCache.at > 120_000) rainCache = { at: Date.now(), body: JSON.stringify(await fetchRain()) };
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        return res.end(rainCache.body);
      } catch (e) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: String(e.message) }));
      }
    }
    if (url.pathname === '/api/stations') {
      try {
        if (!cache.body || Date.now() - cache.at > 60_000) {
          cache = { at: Date.now(), body: JSON.stringify(await fetchUpstream()) };
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        return res.end(cache.body);
      } catch (e) {
        if (cache.body) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'X-Cache': 'STALE' });
          return res.end(cache.body);
        }
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: String(e.message) }));
      }
    }
    const path = normPath(join(root, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!path.startsWith(root)) return res.writeHead(403).end();
    try {
      const file = await readFile(path);
      res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' });
      res.end(file);
    } catch {
      res.writeHead(404).end('not found');
    }
  })
  .listen(PORT, () => console.log(`คลองกรุงเทพฯ พร้อมใช้งานที่ http://localhost:${PORT}  ·  สถิติ: http://localhost:${PORT}/stats.html (รหัส: ${STATS_KEY})`));
