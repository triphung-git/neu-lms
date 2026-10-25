import { readFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const schemaPath = resolve(__dirname, '../../schema/openapi.json');
const currentDtsPath = resolve(__dirname, '../src/api/schema.d.ts');
const tempDtsPath = resolve(__dirname, '../src/api/.schema.d.ts.tmp');

// The artifact must be JSON, matching the backend CI generation format.
try {
  JSON.parse(readFileSync(schemaPath, 'utf8'));
  const currentDts = readFileSync(currentDtsPath, 'utf8').replace(/\r\n/g, '\n');

  // Run the generator into the temp file to get exact byte-for-byte CLI output
  execSync(`npx openapi-typescript "${schemaPath}" -o "${tempDtsPath}"`, {
    cwd: resolve(__dirname, '..'),
    stdio: 'pipe',
  });

  const generatedDts = readFileSync(tempDtsPath, 'utf8').replace(/\r\n/g, '\n');

  try {
    unlinkSync(tempDtsPath);
  } catch {
    // Ignore cleanup error
  }

  if (currentDts.trim() !== generatedDts.trim()) {
    console.error('❌ Drift detected between schema/openapi.json and frontend/src/api/schema.d.ts');
    console.error('Run `npm run api:generate` in frontend to synchronize typed client.');
    process.exit(1);
  }

  console.log('✅ Typed client schema.d.ts is up-to-date with schema/openapi.json');
} catch (err) {
  try {
    unlinkSync(tempDtsPath);
  } catch {
    // Ignore
  }
  console.error('Error checking API drift:', err.message || err);
  process.exit(1);
}
