import { readFile, mkdir, cp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
/** Explicit allowlist: no raw catalogs, lock, intermediate NPZ or credentials in the website. */
export async function exportTerritory(source, destination) {
  const body = await readFile(join(source, 'manifest.json'));
  const manifest = JSON.parse(body);
  if (manifest.version !== 1 || manifest.observations.some(o => !manifest.scenes.some(s => s.id === o.sceneId))) throw Error('Territory manifest invalid');
  const files = new Set();
  for (const o of manifest.observations) {
    for (const name of [...Object.values(o.layers), o.rasterLocation]) files.add(name);
    const sha = createHash('sha256').update(await readFile(join(source, o.rasterLocation))).digest('hex');
    if (sha !== o.classificationSha256) throw Error('Classification integrity failed');
  }
  for (const c of manifest.changes) files.add(c.layer);
  for (const file of files) {
    if (!/^(observations|changes)\/[a-f0-9_]+\/[a-z]+\.(webp|png|tif)$/.test(file)) throw Error('Unsafe territory path');
    await mkdir(resolve(destination, file, '..'), { recursive: true });
    await cp(join(source, file), join(destination, file));
  }
  await mkdir(destination, { recursive: true });
  await writeFile(join(destination, 'manifest.json'), body);
}
if (process.argv[1]?.endsWith('/export.mjs')) await exportTerritory(process.argv[2] ?? 'data/territory', process.argv[3] ?? 'public/territory');
