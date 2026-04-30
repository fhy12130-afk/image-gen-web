import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

describe('one-click startup scripts', () => {
  it('provides a Windows batch launcher that installs dependencies and starts dev servers', () => {
    const script = readFileSync(resolve(root, 'start.bat'), 'utf8');

    expect(script).toContain('npx pnpm@9.15.4 install');
    expect(script).toContain('npx pnpm@9.15.4 dev');
    expect(script).toContain('http://localhost:5173');
  });

  it('provides a PowerShell launcher with the same dev command', () => {
    const script = readFileSync(resolve(root, 'start.ps1'), 'utf8');

    expect(script).toContain('npx pnpm@9.15.4 install');
    expect(script).toContain('npx pnpm@9.15.4 dev');
  });
});
