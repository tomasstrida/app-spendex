const readline = require('readline');
const Database = require('better-sqlite3');

const PROD_URL = 'https://app-spendex-production.up.railway.app';
const LOCAL_DB = require('path').join(__dirname, '../data.db');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (q) => new Promise(r => rl.question(q, r));

(async () => {
  const email = await question('Prod email: ');
  const password = await question('Prod heslo: ');
  rl.close();

  console.log('\nPřihlašuji se na prod...');
  const loginRes = await fetch(`${PROD_URL}/auth/local`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!loginRes.ok) {
    const err = await loginRes.json();
    console.error('Přihlášení selhalo:', err.error);
    process.exit(1);
  }

  const cookie = loginRes.headers.get('set-cookie');
  console.log('Přihlášení OK.');

  console.log('Stahuji kategorie...');
  const catRes = await fetch(`${PROD_URL}/api/categories`, {
    headers: { Cookie: cookie },
  });

  if (!catRes.ok) {
    console.error('Chyba při načítání kategorií:', catRes.status);
    process.exit(1);
  }

  const categories = await catRes.json();
  console.log(`Nalezeno ${categories.length} kategorií.`);

  const db = new Database(LOCAL_DB);
  const insert = db.prepare(
    'INSERT OR IGNORE INTO categories (id, user_id, name, color, icon) VALUES (?, ?, ?, ?, ?)'
  );

  let inserted = 0;
  for (const c of categories) {
    const r = insert.run(c.id, c.user_id, c.name, c.color, c.icon);
    if (r.changes) inserted++;
  }

  console.log(`Hotovo: vloženo ${inserted} kategorií (${categories.length - inserted} přeskočeno jako duplicity).`);
  db.close();
})();
