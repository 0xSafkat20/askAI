import './sync-pdf-worker.mjs';
process.env.NITRO_PRESET = 'vercel';
const { createBuilder } = await import('vite');
const builder = await createBuilder();
await builder.buildApp();
