import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const dataDir = path.resolve(here, '../data');
const storePath = path.join(dataDir, 'store.json');
const initial = { talks: [], sources: [], reports: [] };

export async function readStore() {
  await mkdir(dataDir, { recursive: true });
  try {
    return { ...initial, ...JSON.parse(await readFile(storePath, 'utf8')) };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return structuredClone(initial);
  }
}

export async function writeStore(store) {
  await mkdir(dataDir, { recursive: true });
  const tempPath = `${storePath}.tmp`;
  await writeFile(tempPath, JSON.stringify(store, null, 2), { mode: 0o600 });
  await rename(tempPath, storePath);
}

export function id(prefix = 'id') {
  return `${prefix}_${randomUUID()}`;
}
