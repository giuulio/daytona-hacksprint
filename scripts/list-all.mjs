import 'dotenv/config';
import { Daytona } from '@daytonaio/sdk';
const d = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
const r = await d.list();
const arr = Array.isArray(r) ? r : (r.items ?? []);
console.log('returned by list():', arr.length);
let mem = 0;
for (const s of arr) {
  const p = JSON.parse(JSON.stringify(s));
  console.log(` ${p.id?.slice(0,8)} state=${p.state} mem=${p.mem ?? p.memory ?? '?'} cpu=${p.cpu ?? '?'} snapshot=${p.snapshot ?? ''} labels=${JSON.stringify(p.labels ?? {})}`);
  if (p.state !== 'destroyed') mem += Number(p.mem ?? 0);
}
console.log('total mem attributed:', mem, 'GiB');
