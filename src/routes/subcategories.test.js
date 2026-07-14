'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os'); const path = require('path');
const express = require('express');

function setup() {
  const tmp = path.join(os.tmpdir(), `spendex-subcat-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./subcategories']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id,email) VALUES (1,'o@x')").run();
  db.prepare("INSERT INTO categories (id,user_id,name) VALUES (5,1,'Licence')").run();
  const app = express(); app.use(express.json());
  app.use((req,_res,next)=>{ req.user={id:1}; req.dataUserId=1; req.isAuthenticated=()=>true; next(); });
  app.use('/api/subcategories', require('./subcategories'));
  return { db, app };
}
async function listen(app){ const s=await new Promise(r=>{const x=app.listen(0,()=>r(x));}); return {server:s, base:`http://127.0.0.1:${s.address().port}`}; }

test('POST + GET podle category_id', async () => {
  const { app } = setup(); const { server, base } = await listen(app);
  const post = await fetch(`${base}/api/subcategories`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ category_id:5, name:'ChatGPT' }) });
  assert.equal(post.status, 201);
  const list = await (await fetch(`${base}/api/subcategories?category_id=5`)).json();
  assert.equal(list.length, 1); assert.equal(list[0].name, 'ChatGPT');
  server.close();
});

test('POST duplicitní název v kategorii → 409/400', async () => {
  const { app } = setup(); const { server, base } = await listen(app);
  await fetch(`${base}/api/subcategories`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ category_id:5, name:'ChatGPT' }) });
  const dup = await fetch(`${base}/api/subcategories`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ category_id:5, name:'ChatGPT' }) });
  assert.ok(dup.status >= 400);
  server.close();
});
