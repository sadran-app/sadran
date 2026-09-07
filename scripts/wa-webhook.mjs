// Standalone WhatsApp webhook receiver — PILOT / LOCAL ONLY.
// Zero deps, no DB: appends every inbound message to wa-inbound.jsonl.
// Fully isolated from the live site (which stays on MockChannel, untouched).
//
// Run:  WHATSAPP_VERIFY_TOKEN=sadran-verify node scripts/wa-webhook.mjs
// Then tunnel it:  cloudflared tunnel --url http://localhost:3005
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.WA_WEBHOOK_PORT || 3005);
const VERIFY = process.env.WHATSAPP_VERIFY_TOKEN || 'sadran-verify';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = process.env.WA_INBOUND_FILE || path.join(process.cwd(), 'wa-inbound.jsonl');
const FORM = path.join(HERE, 'availability-form.html');

function extract(m) {
  if (m.type === 'text') return { kind: 'text', text: m.text?.body ?? '' };
  if (m.type === 'interactive') {
    const i = m.interactive || {};
    if (i.type === 'button_reply') return { kind: 'button', text: i.button_reply?.title, id: i.button_reply?.id };
    if (i.type === 'list_reply') return { kind: 'list', text: i.list_reply?.title, id: i.list_reply?.id };
    if (i.type === 'nfm_reply') return { kind: 'flow', text: i.nfm_reply?.response_json };
  }
  return { kind: m.type, text: JSON.stringify(m).slice(0, 300) };
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'GET' && u.pathname === '/webhook') {
    if (u.searchParams.get('hub.mode') === 'subscribe' && u.searchParams.get('hub.verify_token') === VERIFY) {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(u.searchParams.get('hub.challenge') || '');
      console.log('[webhook] verification handshake ✓');
      return;
    }
    res.writeHead(403); res.end('forbidden'); return;
  }
  if (req.method === 'POST' && u.pathname === '/webhook') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('EVENT_RECEIVED');
      try {
        const j = JSON.parse(body || '{}');
        const value = j?.entry?.[0]?.changes?.[0]?.value;
        const msgs = value?.messages || [];
        for (const m of msgs) {
          const e = extract(m);
          const rec = { at: new Date().toISOString(), from: m.from, ...e };
          fs.appendFileSync(FILE, JSON.stringify(rec) + '\n');
          console.log(`[WhatsApp <- ${m.from}] ${e.kind}: ${e.text}`);
        }
      } catch (err) {
        console.error('[webhook] parse error:', err.message);
      }
    });
    return;
  }
  if (req.method === 'GET' && u.pathname === '/availability') {
    try {
      const html = fs.readFileSync(FORM);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(500); res.end('form not found: ' + e.message);
    }
    return;
  }
  if (req.method === 'POST' && u.pathname === '/availability') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
      try {
        const j = JSON.parse(body || '{}');
        const rec = {
          at: new Date().toISOString(),
          from: (j.employee && j.employee.phone) || 'form',
          kind: 'form',
          availability: j.availability || [],
          employee: j.employee || null,
        };
        fs.appendFileSync(FILE, JSON.stringify(rec) + '\n');
        console.log(`[FORM <- ${rec.from}] ${JSON.stringify(rec.availability)}`);
      } catch (err) {
        console.error('[form] parse error:', err.message);
      }
    });
    return;
  }
  if (u.pathname === '/') { res.writeHead(200); res.end('sadran wa-webhook up'); return; }
  res.writeHead(404); res.end('not found');
});

server.listen(PORT, () => console.log(`wa-webhook listening on :${PORT} | verify="${VERIFY}" | file=${FILE}`));
