import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { serve as honoServe } from '@hono/node-server';
import { streamSSE } from 'hono/streaming';
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

/**
 * SAVE — the fast half of capture. Writes the raw item to inbox/ and returns.
 * No Codex, no inference, no commit. This is what a highlight should cost.
 */
app.post('/save', async (c) => {
  const t0 = Date.now();
  const body = (await c.req.json()) as CaptureInput;
  if (!body?.text?.trim()) return c.json({ ok: false, error: 'text required' }, 400);
  try {
    const sb = await getVaultSandbox();
    const rel = await writeToInbox(sb, body);
    metric('save_ms', Date.now() - t0);
    return c.json({ ok: true, inbox: rel });
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message ?? e) }, 500);
  }
});

/**
 * FILE — the slow half. Runs Codex in the vault sandbox to route the item,
 * name it, write frontmatter, link it, and commit. Seconds, not milliseconds.
 */
app.post('/file', async (c) => {
  const t0 = Date.now();
  const { inbox } = (await c.req.json()) as { inbox: string };
  if (!inbox) return c.json({ ok: false, error: 'inbox path required' }, 400);
  try {
    const sb = await getVaultSandbox();
    const result = await fileCapture(sb, inbox);
    await syncVaultDown(sb);
    metric('file_ms', Date.now() - t0);
    return c.json({ ok: true, ...result });
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message ?? e) }, 500);
  }
});

/** What is sitting in inbox/ unfiled, for the HUD's session list to reconcile against. */
app.get('/api/inbox', async (c) => {
  try {
    const sb = await getVaultSandbox();
    const r = await sb.process.executeCommand(
      `cd /root/vault && ls inbox/*.md 2>/dev/null || true`, undefined, undefined, 30,
    );
    const files = (r.result ?? '').trim().split('\n').filter((f) => f.endsWith('.md'));
    return c.json({ ok: true, files });
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

/**
 * Same as /synthesize, but streams progress. The ideas and their citations land
 * ~45s before the prototypes finish, so the UI can render cards early instead of
 * showing a spinner for the full ~115s.
 */
app.get('/synthesize/stream', (c) =>
  streamSSE(c, async (stream) => {
    const t0 = Date.now();
    const send = (type: string, data: Record<string, unknown> = {}) =>
      stream.writeSSE({ data: JSON.stringify({ type, ...data }) });

    try {
      send('status', { msg: 'waking the vault sandbox' });
      const sb = await getVaultSandbox();
      const reaped = await reapStale(sb.id);
      if (reaped) send('status', { msg: `reclaimed ${reaped} orphaned sandbox(es)` });

      const emit = (type: string, data?: Record<string, unknown>) => { void send(type, data ?? {}); };
      const focus = c.req.query('focus') ?? '';
      if (focus) send('status', { msg: `steering: "${focus.slice(0, 70)}"` });
      const ideas = await proposeIdeas(sb, 3, emit, focus);
      metric('ideas_proposed', ideas.length);
      await send('ideas', { ideas: ideas.map((i, n) => ({ ...i, slug: slugOf(i.title), n })) });

      const settled = await Promise.allSettled(ideas.map((i) => buildPrototype(sb, i, emit)));
      const live = settled.filter((s) => s.status === 'fulfilled' && (s.value as any).ok).length;
      metric('synthesize_total_ms', Date.now() - t0);
      metric('prototypes_live', live);
      await send('done', { live, total: ideas.length, ms: Date.now() - t0, sandboxesCreated: sandboxesCreated() });
    } catch (e: any) {
      await send('error', { error: String(e?.message ?? e), cached: listCached() });
    }
  }),
);

const slugOf = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

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
