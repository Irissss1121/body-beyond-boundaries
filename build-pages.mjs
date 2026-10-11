import { cp, mkdir, writeFile } from 'node:fs/promises';
await mkdir(new URL('./docs/', import.meta.url), { recursive: true });
await cp(new URL('./dist/', import.meta.url), new URL('./docs/', import.meta.url), { recursive: true });
await writeFile(new URL('./docs/.nojekyll', import.meta.url), '');
console.log('GitHub Pages files are ready in docs/.');
