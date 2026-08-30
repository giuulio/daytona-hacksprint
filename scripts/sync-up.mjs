import 'dotenv/config';
import { Daytona } from '@daytonaio/sdk';
import { readFileSync } from 'node:fs';
const d = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
const sb = await d.get(readFileSync('.cache/vault-sandbox-id','utf8').trim());
for (const f of process.argv.slice(2)) {
  await sb.fs.uploadFile(readFileSync(f), `/root/${f}`);
  console.log('uploaded', f);
}
await sb.process.executeCommand('cd /root/vault && git add -A && git commit -qm "clean markers" 2>&1 | tail -1', undefined, undefined, 60);
console.log('committed in sandbox');
