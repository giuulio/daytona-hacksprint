import 'dotenv/config';
import { Daytona } from '@daytonaio/sdk';
import { execSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';

const d = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
const metric = (k, v) => { appendFileSync('metrics.jsonl', JSON.stringify({ t: new Date().toISOString(), k, v }) + '\n'); console.log(`  [metric] ${k}=${v}`); };
const ok = (s) => console.log(`   ✅ ${s}`);

console.log('1. tar the vault (no macOS xattrs)');
execSync('COPYFILE_DISABLE=1 tar --no-xattrs -czf /tmp/vault.tgz -C vault .', { stdio: 'inherit' });

console.log('2. create sandbox from warm snapshot');
const t0 = Date.now();
const sb = await d.create({ snapshot: 'inbox-codex-v1', autoStopInterval: 15, autoDeleteInterval: 30 }, { timeout: 120 });
const cold = Date.now() - t0;
metric('cold_start_ms', cold);
ok(`sandbox ${sb.id} up in ${cold}ms`);

try {
  console.log('3. upload vault + git init');
  await sb.fs.uploadFile(readFileSync('/tmp/vault.tgz'), '/root/vault.tgz');
  let r = await sb.process.executeCommand(
    'git config --global --add safe.directory "*" && ' +
    'mkdir -p /root/vault && tar xzf /root/vault.tgz -C /root/vault 2>/dev/null && ' +
    'cd /root/vault && git init -q && git add -A && git commit -qm "seed vault" && ' +
    'echo "TRACKED=$(git ls-files \'*.md\' | wc -l)"', undefined, undefined, 60);
  ok(r.result.trim());

  console.log('4. ripgrep across the vault');
  r = await sb.process.executeCommand('cd /root/vault && echo "notes mentioning feedback: $(rg -l feedback -g \'*.md\' | wc -l)" && echo "distinct tags: $(rg -N --no-filename \'^tags:\' | wc -l)"', undefined, undefined, 60);
  ok(r.result.trim().replace(/\n/g, '\n   ✅ '));

  console.log('5. serve a page via SESSION (runAsync) so the call returns');
  await sb.process.executeCommand('mkdir -p /root/site && printf "<h1>inbox proof</h1>" > /root/site/index.html');
  await sb.process.createSession('web');
  const cmd = await sb.process.executeSessionCommand('web', { command: 'cd /root/site && python3 -m http.server 3000', runAsync: true });
  ok(`server launched async, cmdId=${cmd.cmdId}`);
  await new Promise(r => setTimeout(r, 2500));

  const pl = await sb.getPreviewLink(3000);
  ok(`preview keys: ${Object.keys(pl).join(', ')}`);
  console.log('   url:', pl.url);
  if (pl.token) console.log('   token:', String(pl.token).slice(0, 10) + '...');

  console.log('6. CAN IT BE IFRAMED?');
  const res = await fetch(pl.url, { redirect: 'follow' });
  console.log('   status:', res.status);
  for (const h of ['x-frame-options', 'content-security-policy', 'access-control-allow-origin', 'content-type']) {
    console.log(`   ${h}: ${res.headers.get(h) ?? '(absent)'}`);
  }
  const body = await res.text();
  console.log('   body:', JSON.stringify(body.slice(0, 100)));
  const framable = !res.headers.get('x-frame-options') && !(res.headers.get('content-security-policy') || '').includes('frame-ancestors');
  metric('preview_iframeable', framable);
  console.log(framable ? '   ✅ IFRAMEABLE — grid can embed directly' : '   ⚠️  NOT iframeable — need same-origin proxy');
} finally {
  console.log('cleanup: deleting sandbox');
  await sb.delete().catch(e => console.log('   delete failed:', e.message));
}
