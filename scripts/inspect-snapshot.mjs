import 'dotenv/config';
import { Daytona } from '@daytonaio/sdk';
const d = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
for (const n of ['inbox-codex-v1', 'inbox-codex-v2']) {
  try {
    const s = await d.snapshot.get(n);
    const plain = JSON.parse(JSON.stringify(s));
    console.log(n, '->', JSON.stringify(Object.fromEntries(Object.entries(plain).filter(([k]) => /cpu|mem|disk|gpu|state|name/i.test(k)))));
  } catch (e) { console.log(n, 'ERR', e.message); }
}
