import { readFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendDir = resolve(scriptDir, '..');

const schemaPath = resolve(frontendDir, '../schema/openapi.json');
const currentPath = resolve(frontendDir, 'src/api/schema.d.ts');
const tempPath = resolve(frontendDir, 'src/api/.schema.d.ts.tmp');

try {
  JSON.parse(readFileSync(schemaPath, 'utf8'));

  const current = readFileSync(currentPath, 'utf8')
    .replace(/\r\n/g, '\n');

  execFileSync(
    process.execPath,
    [
      'node_modules/openapi-typescript/bin/cli.js',
      '../schema/openapi.json',
      '-o',
      'src/api/.schema.d.ts.tmp',
    ],
    {
      cwd: frontendDir,
      stdio: 'pipe',
    },
  );

  const generated = readFileSync(tempPath, 'utf8')
    .replace(/\r\n/g, '\n');

  if (current.trim() !== generated.trim()) {
    console.error('Schema TypeScript chưa khớp với OpenAPI.');
    console.error('Hãy chạy: npm run api:generate');
    process.exitCode = 1;
  } else {
    console.log('OK: schema.d.ts khớp với openapi.json.');
  }
} catch (error) {
  console.error(
    'Không kiểm tra được API:',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
} finally {
  try {
    unlinkSync(tempPath);
  } catch {
    // Không cần xóa nếu tệp tạm chưa được tạo.
  }
}