import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    maxWorkers: 2,
    minWorkers: 1,
    setupFiles: ['./tests/setup.ts'],
    server: { deps: { inline: ['ppu-paddle-ocr', 'ppu-ocv'] } },
  },
});
