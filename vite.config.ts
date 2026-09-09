import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig, loadEnv } from 'vite';

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

export default defineConfig(({ mode }) => {
  // Run locally in Node, matching the process.env-based application runtime.
  // Only copy server settings; never inject secret values through Vite define.
  const localEnv = loadEnv(mode, process.cwd(), '');
  for (const key of [
    'SUPABASE_URL',
    'SUPABASE_PUBLISHABLE_KEY',
    'GEMINI_API_KEY',
    'GEMINI_MODEL',
  ]) {
    if (process.env[key] === undefined && localEnv[key] !== undefined) {
      process.env[key] = localEnv[key];
    }
  }

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [vinext(), sites()],
  };
});
