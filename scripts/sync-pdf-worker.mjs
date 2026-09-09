import { copyFile, mkdir } from 'node:fs/promises';

// Resolve from the installed package so the API and worker versions always match.
const source = new URL(import.meta.resolve('pdfjs-dist/build/pdf.worker.min.mjs'));
const directory = new URL('../public/', import.meta.url);
await mkdir(directory, { recursive: true });
await copyFile(source, new URL('pdf.worker.min.mjs', directory));
