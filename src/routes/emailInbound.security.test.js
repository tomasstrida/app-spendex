'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
function freshApp() {
  process.env.EMAIL_WEBHOOK_SECRET = 'sekret';
  process.env.EMAIL_ALLOWED_SENDER = 'tom@example.com';
  for (const m of ['./emailInbound']) { try { delete require.cache[require.resolve(m)]; } catch {/* ok */} }
  const app = express(); app.use(express.json({ limit: '10mb' }));
  app.use('/api/email', require('./emailInbound'));
  return app;
}
async function listen(app){ const s=await new Promise(r=>{const x=app.listen(0,()=>r(x));}); return {server:s, base:`http://127.0.0.1:${s.address().port}`}; }

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
