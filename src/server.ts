import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { serve as honoServe } from '@hono/node-server';
import { PORT, OPENAI_API_KEY } from './config.ts';
import { getVaultSandbox, sandboxesCreated, syncVaultDown, reapStale } from './daytona.ts';
import { writeToInbox, fileCapture, type CaptureInput } from './capture.ts';
import { proposeIdeas, buildPrototype, readCached, listCached } from './synth.ts';
import { metric } from './metrics.ts';

const app = new Hono();

app.get('/api/health', (c) =>
  c.json({ ok: true, openaiKey: OPENAI_API_KEY ? 'set' : 'MISSING', sandboxesCreated: sandboxesCreated() }),
);

/** Layers 1 + 2: capture lands in inbox/, then an agent files it. No confirmation. */
app.post('/capture', async (c) => {
  const t0 = Date.now();
  const body = (await c.req.json()) as CaptureInput;
  if (!body?.text?.trim()) return c.json({ error: 'text required' }, 400);
  try {
    const sb = await getVaultSandbox();
    const rel = await writeToInbox(sb, body);
    const result = await fileCapture(sb, rel);
    await syncVaultDown(sb);   // so the filed note shows up in Obsidian and the repo
    metric('capture_total_ms', Date.now() - t0);
    return c.json({ ok: true, inbox: rel, ...result });
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message ?? e) }, 500);
  }
});

/** Layer 3: overlaps -> ideas with citations -> N sandboxes each building a live prototype. */
app.post('/synthesize', async (c) => {
  const t0 = Date.now();
  try {
    const sb = await getVaultSandbox();
    await reapStale(sb.id);          // 10GiB org cap: clear orphans before the fan-out
    const ideas = await proposeIdeas(sb, 3);
    metric('ideas_proposed', ideas.length);

    // INVARIANT 6: allSettled — one dead sandbox must not blank the grid.
    const settled = await Promise.allSettled(ideas.map((i) => buildPrototype(sb, i)));
    const prototypes = settled.map((s, i) =>
      s.status === 'fulfilled'
        ? s.value
        : { ...ideas[i], slug: '', url: null, ok: false, error: String(s.reason?.message ?? s.reason) },
    );
    metric('synthesize_total_ms', Date.now() - t0);
    metric('prototypes_live', prototypes.filter((p) => p.ok).length);
    return c.json({ ok: true, prototypes, sandboxesCreated: sandboxesCreated() });
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message ?? e), cached: listCached() }, 500);
  }
});

/** Warm path: cached prototypes served same-origin, so the demo works even if live gen dies. */
app.get('/p/:slug', (c) => {
  const html = readCached(c.req.param('slug'));
  return html ? c.html(html) : c.text('no cached prototype', 404);
});

app.get('/api/cached', (c) => c.json(listCached()));

app.use('/*', serveStatic({ root: './public' }));

honoServe({ fetch: app.fetch, port: PORT }, (i) => {
  console.log(`\n  inbox → http://localhost:${i.port}`);
  console.log(`  openai key: ${OPENAI_API_KEY ? 'set' : 'MISSING — layers 2 and 3 will fail'}\n`);
});
