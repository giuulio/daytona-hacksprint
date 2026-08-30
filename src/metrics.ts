import { appendFileSync } from 'node:fs';

export function metric(k: string, v: unknown) {
  const line = JSON.stringify({ t: new Date().toISOString(), k, v });
  try { appendFileSync('metrics.jsonl', line + '\n'); } catch {}
  console.log(`[metric] ${k}=${JSON.stringify(v)}`);
}

export async function timed<T>(k: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try { return await fn(); } finally { metric(k, Date.now() - t0); }
}
