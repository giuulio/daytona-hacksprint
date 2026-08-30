import type { Sandbox } from '@daytonaio/sdk';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { VAULT_REMOTE } from './config.ts';
import { createPrototypeSandbox, runCodex, serve } from './daytona.ts';
import { metric } from './metrics.ts';

export type Emit = (type: string, data?: Record<string, unknown>) => void;
const noop: Emit = () => {};

export type Idea = {
  title: string;
  oneLiner: string;
  whyYou: string;
  sourceNotes: string[]; // INVARIANT 5: real filenames from the vault
};

const CACHE_DIR = '.cache/prototypes';

/** Codex writes JSON to a file; models like to wrap it in prose or fences. Dig it out. */
function extractJson(raw: string): any {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error(`no JSON object found in: ${raw.slice(0, 300)}`);
  return JSON.parse(candidate.slice(start, end + 1));
}

/** Step A: compressed index — title + tags + first ~200 chars of every note. */
export async function buildIndex(sb: Sandbox): Promise<string> {
  const r = await sb.process.executeCommand(
    `cd ${VAULT_REMOTE} && for f in $(git ls-files '*.md' | grep -v '^templates/'); do ` +
      `echo "@@FILE $f"; head -c 400 "$f" | tr '\\n' ' '; echo; done`,
    undefined,
    undefined,
    90,
  );
  return (r.result ?? '').slice(0, 60000);
}

/** Steps A+B: find cross-domain overlaps and propose ideas that cite real notes. */
export async function proposeIdeas(sb: Sandbox, n = 3, emit: Emit = noop): Promise<Idea[]> {
  emit('status', { msg: 'reading the vault' });
  const index = await buildIndex(sb);
  const noteCount = (index.match(/^@@FILE /gm) ?? []).length;
  emit('indexed', { notes: noteCount });
  emit('status', { msg: 'looking for cross-domain overlaps' });

  const prompt = `You are in a personal markdown knowledge vault at ${VAULT_REMOTE}.

Here is an index of every note. Each entry is a line '@@FILE <path>' followed by that note's opening text:

${index}

TASK: identify exactly ${n} CROSS-DOMAIN overlaps between clusters of notes that are
NOT obviously related — the connection should be surprising. Ignore pairs from the
same folder or the same subject. You may explore with 'rg "term" .' and 'cat' to
confirm your reading (always pass the "." to rg — without a path it reads stdin and
silently returns nothing).

For each overlap, propose ONE project idea buildable as a single self-contained HTML page.

Write your answer to /tmp/ideas.json and nothing else. Exact schema:

{"ideas":[{"title":"short concrete name","oneLiner":"what it does, one sentence","whyYou":"one sentence on why THIS vault produced this idea","sourceNotes":["exact/path/from/index.md","another/real/path.md"]}]}

RULES:
- sourceNotes MUST be exact paths copied from the index above. 2-4 per idea.
- Valid JSON only in that file. No markdown fences, no commentary.
- Do not ask questions. Write the file.`;

  const t0 = Date.now();
  const res = await runCodex(sb, prompt, VAULT_REMOTE, 300);
  metric('synthesis_codex_ms', Date.now() - t0);
  emit('overlaps_ms', { ms: Date.now() - t0 });

  let raw: string;
  try {
    raw = (await sb.fs.downloadFile('/tmp/ideas.json')).toString('utf8');
  } catch {
    throw new Error(`Codex wrote no /tmp/ideas.json. Tail: ${res.output.slice(-500)}`);
  }

  const parsed = extractJson(raw).ideas as Idea[];
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('no ideas in ideas.json');

  // INVARIANT 5: citations must be real files. Drop hallucinated paths.
  const real = new Set(
    (await sb.process.executeCommand(`cd ${VAULT_REMOTE} && git ls-files '*.md'`, undefined, undefined, 30)).result
      ?.trim()
      .split('\n') ?? [],
  );
  for (const idea of parsed) {
    const before = (idea.sourceNotes ?? []).length;
    idea.sourceNotes = (idea.sourceNotes ?? []).filter((f) => real.has(f));
    if (idea.sourceNotes.length !== before) metric('citation_hallucinated', before - idea.sourceNotes.length);
  }
  return parsed.filter((i) => i.sourceNotes.length > 0);
}

const PROTOTYPE_PROMPT = (idea: Idea, notes: string) => `Build a working prototype of this idea.

TITLE: ${idea.title}
WHAT IT DOES: ${idea.oneLiner}
WHY IT CAME FROM THIS VAULT: ${idea.whyYou}

It was synthesised from these notes:

${notes}

REQUIREMENTS — these are absolute:
- Output EXACTLY ONE file: /root/site/index.html
- Fully self-contained: inline <style> and <script>. No build step, no npm,
  no external requests, no CDN links, no fonts from the network.
- Maximum ~300 lines. Working and small beats ambitious and broken.
- It must DO something when opened — interactive, not a description of itself.
- Dark background, generous spacing, one clear idea on screen.
- Include the title and one line naming the notes it came from.

Write the file. Do not explain. Do not ask questions.`;

/** Step C: one sandbox per idea, Codex builds it, return a live preview URL. */
export async function buildPrototype(vaultSb: Sandbox, idea: Idea, emit: Emit = noop) {
  const slug = idea.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
  const t0 = Date.now();

  const noteText = (
    await vaultSb.process.executeCommand(
      `cd ${VAULT_REMOTE} && for f in ${idea.sourceNotes.map((f) => `'${f}'`).join(' ')}; do echo "--- $f"; head -c 1200 "$f"; echo; done`,
      undefined,
      undefined,
      60,
    )
  ).result ?? '';

  let sb: Sandbox | undefined;
  try {
    const tSb = Date.now();
    sb = await createPrototypeSandbox(idea.title);
    emit('sandbox_up', { slug, sandboxId: sb.id.slice(0, 8), ms: Date.now() - tSb });
    await sb.process.executeCommand('mkdir -p /root/site', undefined, undefined, 30);
    emit('building', { slug });
    const codex = await runCodex(sb, PROTOTYPE_PROMPT(idea, noteText), '/root/site', 420);

    const check = await sb.process.executeCommand(
      'test -s /root/site/index.html && wc -l < /root/site/index.html || echo MISSING',
      undefined,
      undefined,
      30,
    );
    if ((check.result ?? '').includes('MISSING')) {
      throw new Error(`Codex produced no index.html. Tail: ${codex.output.slice(-400)}`);
    }

    const html = (await sb.fs.downloadFile('/root/site/index.html')).toString('utf8');
    mkdirSync(`${CACHE_DIR}/${slug}`, { recursive: true });
    writeFileSync(`${CACHE_DIR}/${slug}/index.html`, html);
    writeFileSync(`${CACHE_DIR}/${slug}/idea.json`, JSON.stringify(idea, null, 2));

    const url = await serve(sb, '/root/site');
    metric('paste_to_prototype_ms', Date.now() - t0);
    const lines = (check.result ?? '').trim();
    emit('live', { slug, url, lines, ms: Date.now() - t0 });
    return { ...idea, slug, url, cached: true, sandboxId: sb.id, lines, ok: true };
  } catch (e: any) {
    // INVARIANT 6: one failure must not take down the others.
    metric('prototype_failed', idea.title);
    emit('failed', { slug, error: String(e?.message ?? e).slice(0, 200) });
    return { ...idea, slug, url: null, cached: existsSync(`${CACHE_DIR}/${slug}/index.html`), ok: false, error: String(e?.message ?? e) };
  }
}

/** Warm path for the demo: serve whatever we cached earlier, even if live generation dies. */
export function readCached(slug: string): string | null {
  const p = `${CACHE_DIR}/${slug}/index.html`;
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

export function listCached(): Array<Idea & { slug: string }> {
  if (!existsSync(CACHE_DIR)) return [];
  return readdirSync(CACHE_DIR)
    .filter((d: string) => existsSync(`${CACHE_DIR}/${d}/idea.json`))
    .map((d: string) => ({ ...JSON.parse(readFileSync(`${CACHE_DIR}/${d}/idea.json`, 'utf8')), slug: d }));
}
