'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const os = require('os'); const path = require('path'); const fs = require('fs');
function freshApp() {
  process.env.EMAIL_WEBHOOK_SECRET = 'sekret';
  process.env.EMAIL_ALLOWED_SENDER = 'tom@example.com';
  for (const m of ['./emailInbound']) { try { delete require.cache[require.resolve(m)]; } catch {/* ok */} }
  const app = express(); app.use(express.json({ limit: '10mb' }));
  app.use('/api/email', require('./emailInbound'));
  return app;
}
async function listen(app){ const s=await new Promise(r=>{const x=app.listen(0,()=>r(x));}); return {server:s, base:`http://127.0.0.1:${s.address().port}`}; }

async function setupInbound(env = {}) {
  process.env.EMAIL_WEBHOOK_SECRET = 'sekret';
  process.env.EMAIL_ALLOWED_SENDER = 'tom@example.com';
  // Apple cesta stojí na adrese přeposílatele ve `from` hlavičce (viz C1).
  process.env.EMAIL_APPLE_FORWARDER = 'tomas@icloud.com';
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  process.env.DB_PATH = path.join(os.tmpdir(), `spendex-inb-${Date.now()}-${Math.random()}.db`);
  for (const m of ['../db/connection','../db/schema','./emailInbound','../services/appleReceipts']) {
    try { delete require.cache[require.resolve(m)]; } catch { /* ok */ }
  }
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'tom@example.com')").run();
  const app = express(); app.use(express.json({ limit: '10mb' }));
  app.use('/api/email', require('./emailInbound'));
  const { server, base } = await listen(app);
  return { db, app, base, server };
}

test('špatný secret → 401', async () => {
  const app = freshApp(); const { server, base } = await listen(app);
  const r = await fetch(`${base}/api/email/inbound?secret=spatne`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ from:'x@airbank.cz', raw:'tom@example.com' }) });
  server.close();
  assert.equal(r.status, 401);
});
test('správný secret ale raw > 1MB → 413', async () => {
  const app = freshApp(); const { server, base } = await listen(app);
  const big = 'tom@example.com' + 'x'.repeat(1_000_001);
  const r = await fetch(`${base}/api/email/inbound?secret=sekret`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ from:'info@airbank.cz', raw: big }) });
  server.close();
  assert.equal(r.status, 413);
});

const CARD_TX_TEXT = `zůstatek na účtu Společný číslo 1679014023/3030 se snížil o částku 482,00 CZK. Dostupný zůstatek k 08.06.2026 v 21:15 je 3 678,16 CZK.
Platba kartou (nezaúčtováno) v HAMR - BRANIK,RESTAURA, PRAHA 4, 000
Karta: 516844******6062
Datum provedení: 08.06.2026
Kód transakce: 26918903543`;

test('AirBank notifikace s povolenou adresou v raw projde whitelistem a zapise se', async () => {
  const { db, base, server } = await setupInbound();
  const raw = `From: info@airbank.cz\nDelivered-To: ${process.env.EMAIL_ALLOWED_SENDER}\nSubject: Notifikace o transakci\n\n${CARD_TX_TEXT}`;
  const r = await fetch(`${base}/api/email/inbound`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-secret': process.env.EMAIL_WEBHOOK_SECRET },
    body: JSON.stringify({ from: 'info@airbank.cz', subject: 'Notifikace o transakci', raw }),
  });
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.notEqual(body.status, 'ignored');
  // Bez seedovaných kategorií/účtu jde platba do fronty k ručnímu zařazení — podstatné je,
  // že prošla whitelistem a doputovala do ingestEmail (ne do apple_receipts).
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM email_inbox').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM apple_receipts').get().n, 0);
  server.close();
});

test('AirBank mail se zminkou Apple invoice jde porad AirBank cestou (precedence)', async () => {
  const { db, base, server } = await setupInbound();
  const raw = `From: info@airbank.cz\nDelivered-To: ${process.env.EMAIL_ALLOWED_SENDER}\nSubject: Your invoice from Apple.\n\n${CARD_TX_TEXT}\nno_reply@email.apple.com`;
  const r = await fetch(`${base}/api/email/inbound`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-secret': process.env.EMAIL_WEBHOOK_SECRET },
    body: JSON.stringify({ from: 'info@airbank.cz', subject: 'Your invoice from Apple.', raw }),
  });
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.notEqual(body.status, 'ignored');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM apple_receipts').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM email_inbox').get().n, 1);
  server.close();
});

test('Apple faktura projde a ulozi se jako apple_receipt', async () => {
  const { db, app, base, server } = await setupInbound();
  const raw = fs.readFileSync(path.join(__dirname, '..', 'utils', '__fixtures__', 'apple-invoice.eml'), 'utf8')
    .replace('user@example.com', process.env.EMAIL_ALLOWED_SENDER);
  const r = await fetch(`${base}/api/email/inbound`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-secret': process.env.EMAIL_WEBHOOK_SECRET },
    body: JSON.stringify({ from: 'tomas@icloud.com', subject: 'Your invoice from Apple.', raw }),
  });
  assert.equal(r.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM apple_receipts').get().n, 1);
  server.close();
});

test('Apple mail bez slova invoice se NEulozi', async () => {
  const { db, base, server } = await setupInbound();
  const raw = `From: Apple <no_reply@email.apple.com>\nSubject: Novinky\n\n${process.env.EMAIL_ALLOWED_SENDER} marketing`;
  const r = await fetch(`${base}/api/email/inbound`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-secret': process.env.EMAIL_WEBHOOK_SECRET },
    body: JSON.stringify({ from: 'tomas@icloud.com', subject: 'Novinky', raw }),
  });
  assert.equal((await r.json()).status, 'ignored');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM apple_receipts').get().n, 0);
  server.close();
});

test('Apple mail bez povolene adresy v raw se odmitne', async () => {
  const { db, base, server } = await setupInbound();
  const raw = 'From: Apple <no_reply@email.apple.com>\nSubject: Your invoice from Apple.\n\nInvoice 269,00 CZK';
  const r = await fetch(`${base}/api/email/inbound`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-secret': process.env.EMAIL_WEBHOOK_SECRET },
    body: JSON.stringify({ from: 'utocnik@example.org', subject: 'Your invoice from Apple.', raw }),
  });
  assert.equal((await r.json()).status, 'ignored');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM apple_receipts').get().n, 0);
  server.close();
});

// C1: whitelist Apple cesty musí stát na VNĚJŠÍ `from` hlavičce (tu ověřuje Cloudflare
// Email Routing), ne na obsahu těla, který si odesílatel plně řídí.
test('Apple mail s cizi from hlavickou neprojde, i kdyz ma v tele vsechny spravne retezce', async () => {
  const { db, base, server } = await setupInbound();
  const raw = fs.readFileSync(path.join(__dirname, '..', 'utils', '__fixtures__', 'apple-invoice.eml'), 'utf8')
    .replace('user@example.com', process.env.EMAIL_ALLOWED_SENDER)
    // Do těla si útočník napíše všechno, co filtr hledá:
    + `\n\nFrom: no_reply@email.apple.com\nTo: ${process.env.EMAIL_APPLE_FORWARDER}\ninvoice\n${process.env.EMAIL_ALLOWED_SENDER}\n`;
  const r = await fetch(`${base}/api/email/inbound`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-secret': process.env.EMAIL_WEBHOOK_SECRET },
    body: JSON.stringify({ from: 'utocnik@evil.example', subject: 'Your invoice from Apple.', raw }),
  });
  assert.equal(r.status, 202);
  assert.equal((await r.json()).status, 'ignored');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM apple_receipts').get().n, 0);
  server.close();
});

// C1 follow-up: puvodni oprava presunula whitelist z tela na `From` hlavicku, ale
// porovnani jelo pres `.includes(appleForwarder)` nad CELOU hlavickou vcetne display
// name. Hlavicka `From: "tomas@icloud.com" <utocnik@evil.example>` tak prosla, protoze
// povolena adresa byla schovana v jmene — skutecna adresa (adresni cast v zavorkach)
// byla cizi. S puvodni `.includes` logikou by tento test SELHAL (fromHdr by povolenou
// adresu jako podretezec obsahoval); po oprave na presnou shodu adresni casti musi projit.
test('Apple mail s povolenou adresou schovanou v display name a cizi skutecnou adresou neprojde', async () => {
  const { db, base, server } = await setupInbound();
  const raw = fs.readFileSync(path.join(__dirname, '..', 'utils', '__fixtures__', 'apple-invoice.eml'), 'utf8')
    .replace('user@example.com', process.env.EMAIL_ALLOWED_SENDER);
  const from = `"${process.env.EMAIL_APPLE_FORWARDER}" <utocnik@evil.example>`;
  const r = await fetch(`${base}/api/email/inbound`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-secret': process.env.EMAIL_WEBHOOK_SECRET },
    body: JSON.stringify({ from, subject: 'Your invoice from Apple.', raw }),
  });
  assert.equal(r.status, 202);
  assert.equal((await r.json()).status, 'ignored');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM apple_receipts').get().n, 0);
  server.close();
});

test('bez EMAIL_APPLE_FORWARDER se pouzije EMAIL_ALLOWED_SENDER jako fallback', async () => {
  const { db, base, server } = await setupInbound({ EMAIL_APPLE_FORWARDER: undefined });
  const raw = fs.readFileSync(path.join(__dirname, '..', 'utils', '__fixtures__', 'apple-invoice.eml'), 'utf8')
    .replace('user@example.com', process.env.EMAIL_ALLOWED_SENDER);
  const send = (from) => fetch(`${base}/api/email/inbound`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-secret': process.env.EMAIL_WEBHOOK_SECRET },
    body: JSON.stringify({ from, subject: 'Your invoice from Apple.', raw }),
  });
  assert.equal((await (await send('tomas@icloud.com')).json()).status, 'ignored');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM apple_receipts').get().n, 0);
  assert.equal((await send(process.env.EMAIL_ALLOWED_SENDER)).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM apple_receipts').get().n, 1);
  server.close();
});

test('bez obou promennych je Apple cesta vypnuta', async () => {
  const { db, base, server } = await setupInbound({ EMAIL_APPLE_FORWARDER: undefined, EMAIL_ALLOWED_SENDER: undefined });
  const raw = fs.readFileSync(path.join(__dirname, '..', 'utils', '__fixtures__', 'apple-invoice.eml'), 'utf8');
  const r = await fetch(`${base}/api/email/inbound`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-secret': process.env.EMAIL_WEBHOOK_SECRET },
    body: JSON.stringify({ from: 'tomas@icloud.com', subject: 'Your invoice from Apple.', raw }),
  });
  assert.equal((await r.json()).status, 'ignored');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM apple_receipts').get().n, 0);
  server.close();
});

// Uzivatel ma vic Apple ID a faktury preposila z ruznych schranek — EMAIL_APPLE_FORWARDER
// proto prijima SEZNAM adres oddeleny carkou. Kazda polozka se porovnava na presnou
// shodu adresni casti (stejna ochrana jako u jedne adresy, viz C1).
test('Apple faktura z druhe adresy v seznamu projde', async () => {
  const { db, base, server } = await setupInbound({
    EMAIL_APPLE_FORWARDER: 'prvni@icloud.com, druhy@icloud.com',
  });
  const raw = fs.readFileSync(path.join(__dirname, '..', 'utils', '__fixtures__', 'apple-invoice.eml'), 'utf8')
    .replace('user@example.com', process.env.EMAIL_ALLOWED_SENDER);
  const r = await fetch(`${base}/api/email/inbound`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-secret': process.env.EMAIL_WEBHOOK_SECRET },
    body: JSON.stringify({ from: 'Druhy Ucet <druhy@icloud.com>', subject: 'Your invoice from Apple.', raw }),
  });
  assert.equal(r.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM apple_receipts').get().n, 1);
  server.close();
});

test('Apple faktura z adresy mimo seznam neprojde', async () => {
  const { db, base, server } = await setupInbound({
    EMAIL_APPLE_FORWARDER: 'prvni@icloud.com, druhy@icloud.com',
  });
  const raw = fs.readFileSync(path.join(__dirname, '..', 'utils', '__fixtures__', 'apple-invoice.eml'), 'utf8')
    .replace('user@example.com', process.env.EMAIL_ALLOWED_SENDER);
  const r = await fetch(`${base}/api/email/inbound`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-secret': process.env.EMAIL_WEBHOOK_SECRET },
    body: JSON.stringify({ from: 'treti@icloud.com', subject: 'Your invoice from Apple.', raw }),
  });
  assert.equal((await r.json()).status, 'ignored');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM apple_receipts').get().n, 0);
  server.close();
});
