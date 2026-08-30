import 'dotenv/config';
import { Daytona } from '@daytonaio/sdk';
import { readFileSync } from 'node:fs';
const d = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
const sb = await d.get(readFileSync('.cache/vault-sandbox-id','utf8').trim());
const r = await sb.process.executeCommand(
  `cd /root/vault && rm -f inbox/*warm-save-test* && git add -A && git commit -qm "clear test captures" 2>&1 | tail -1; ls inbox/ | grep -v gitkeep || echo "inbox empty"`,
  undefined, undefined, 60);
console.log(r.result?.trim());
