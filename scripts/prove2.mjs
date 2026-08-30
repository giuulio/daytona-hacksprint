import 'dotenv/config';
import { Daytona } from '@daytonaio/sdk';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const d = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
execSync('COPYFILE_DISABLE=1 tar --no-xattrs -czf /tmp/vault.tgz -C vault .');

const t0 = Date.now();
const sb = await d.create({ snapshot: 'inbox-codex-v1', public: true, autoStopInterval: 15, autoDeleteInterval: 30 }, { timeout: 120 });
console.log(`sandbox ${sb.id} up in ${Date.now() - t0}ms (public:true)`);

try {
  await sb.fs.uploadFile(readFileSync('/tmp/vault.tgz'), '/root/vault.tgz');
  await sb.process.executeCommand('git config --global --add safe.directory "*" && mkdir -p /root/vault && tar xzf /root/vault.tgz -C /root/vault 2>/dev/null && cd /root/vault && git init -q && git add -A && git commit -qm seed', undefined, undefined, 60);

  console.log('\n=== DEBUG rg ===');
  for (const c of [
    'cd /root/vault && ls',
    'cd /root/vault && ls sources | head -3',
    'cd /root/vault && rg -l feedback | wc -l',
    'cd /root/vault && rg --version | head -1',
    'cd /root/vault && grep -rl feedback . --include=*.md | wc -l',
    'cd /root/vault && rg -l feedback . | wc -l',
  ]) {
    const r = await sb.process.executeCommand(c, undefined, undefined, 30);
    console.log(`$ ${c}\n  exit=${r.exitCode} out=${JSON.stringify((r.result||'').trim().slice(0,140))}`);
  }

  console.log('\n=== PUBLIC PREVIEW TEST ===');
  await sb.process.executeCommand('mkdir -p /root/site && printf "<h1>inbox proof</h1>" > /root/site/index.html');
  await sb.process.createSession('web');
  await sb.process.executeSessionCommand('web', { command: 'cd /root/site && python3 -m http.server 3000', runAsync: true });
  await new Promise(r => setTimeout(r, 2500));

  const pl = await sb.getPreviewLink(3000);
  console.log('plain url:', pl.url);
  let res = await fetch(pl.url);
  console.log(`  PLAIN  -> ${res.status} ct=${res.headers.get('content-type')} xfo=${res.headers.get('x-frame-options') ?? 'absent'} csp=${res.headers.get('content-security-policy') ?? 'absent'}`);
  console.log('  body:', JSON.stringify((await res.text()).slice(0, 80)));

  res = await fetch(pl.url, { headers: { 'x-daytona-preview-token': pl.token } });
  console.log(`  TOKEN HEADER -> ${res.status}`);
  console.log('  body:', JSON.stringify((await res.text()).slice(0, 80)));

  try {
    const signed = await sb.getSignedPreviewUrl(3000, 3600);
    console.log('signed:', JSON.stringify(signed).slice(0, 200));
    const su = signed.url || signed;
    res = await fetch(su);
    console.log(`  SIGNED -> ${res.status} xfo=${res.headers.get('x-frame-options') ?? 'absent'}`);
    console.log('  body:', JSON.stringify((await res.text()).slice(0, 80)));
  } catch (e) { console.log('  signed failed:', e.message); }
} finally {
  await sb.delete().catch(() => {});
  console.log('\ndeleted');
}
