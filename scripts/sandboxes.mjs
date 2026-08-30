import 'dotenv/config';

// NOTE: the SDK's daytona.list() came back empty while sandboxes were demonstrably
// alive and holding quota, so this talks to the REST API directly.
const KEY = process.env.DAYTONA_API_KEY;
const BASE = process.env.DAYTONA_API_URL ?? 'https://app.daytona.io/api';
const H = { Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' };

const res = await fetch(`${BASE}/sandbox`, { headers: H });
const body = await res.json();
const items = Array.isArray(body) ? body : (body.items ?? body.data ?? []);

const live = items.filter((s) => !['destroyed', 'deleted'].includes(s.state));
console.log(`sandboxes: ${items.length} total, ${live.length} not destroyed`);
for (const s of items) {
  console.log(`  ${String(s.id).slice(0, 8)}  state=${s.state}  cpu=${s.cpu}  labels=${JSON.stringify(s.labels ?? {})}`);
}

if (process.argv[2] === '--reap') {
  for (const s of live) {
    const r = await fetch(`${BASE}/sandbox/${s.id}?force=true`, { method: 'DELETE', headers: H });
    console.log(`  delete ${String(s.id).slice(0, 8)} -> ${r.status}`);
  }
  console.log('reaped', live.length);
}
