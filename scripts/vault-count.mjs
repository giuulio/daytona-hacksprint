import 'dotenv/config';
import { Daytona } from '@daytonaio/sdk';
import { readFileSync } from 'node:fs';
const d = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
const id = readFileSync('.cache/vault-sandbox-id','utf8').trim();
const sb = await d.get(id);
const r = await sb.process.executeCommand(
  `cd /root/vault && echo "tracked: $(git ls-files '*.md' | wc -l)" && echo "non-template: $(git ls-files '*.md' | grep -v '^templates/' | wc -l)" && echo "--- markers in index:" && for f in $(git ls-files '*.md' | grep -v '^templates/'); do echo "--- $f"; head -c 400 "$f" | tr '\n' ' '; echo; done | grep -c '^--- '`,
  undefined, undefined, 60);
console.log(r.result?.trim());
