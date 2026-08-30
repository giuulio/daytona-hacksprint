import 'dotenv/config';
import { Daytona } from '@daytonaio/sdk';
const d = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
const made = [];
try {
  for (let i = 1; i <= 5; i++) {
    try {
      const sb = await d.create({ snapshot: 'inbox-codex-v2', autoStopInterval: 5, autoDeleteInterval: 10 }, { timeout: 120 });
      made.push(sb);
      const p = JSON.parse(JSON.stringify(sb));
      console.log(`#${i} ok  id=${sb.id.slice(0,8)} mem=${p.mem ?? '?'} cpu=${p.cpu ?? '?'} disk=${p.disk ?? '?'}`);
    } catch (e) {
      console.log(`#${i} FAILED: ${String(e.message).split('\n')[0]}`);
      break;
    }
  }
} finally {
  console.log('cleaning up', made.length);
  await Promise.all(made.map(s => d.delete(s).catch(() => {})));
  console.log('done');
}
