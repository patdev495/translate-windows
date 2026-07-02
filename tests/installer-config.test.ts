import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

describe('installer configuration', () => {
  test('uses release product metadata for Windows installer builds', () => {
    const tauriConfig = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
    const packageConfig = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const cargoToml = readFileSync(join(root, 'src-tauri', 'Cargo.toml'), 'utf8');

    expect(tauriConfig.productName).toBe('PolyTranslate');
    expect(tauriConfig.version).toBe('1.0.0');
    expect(tauriConfig.bundle.active).toBe(true);
    expect(tauriConfig.bundle.targets).toEqual(['msi', 'nsis']);
    expect(packageConfig.version).toBe('1.0.0');
    expect(cargoToml).toContain('version = "1.0.0"');
  });
});
