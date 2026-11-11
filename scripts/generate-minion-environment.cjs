// Reuse the fixed app in an isolated profile to regenerate the prefiltered room light.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result = spawnSync(
  process.execPath,
  [path.join(__dirname, 'playback-smoke.cjs'), process.argv[2] || '', '--generate-environment'],
  { stdio: 'inherit', windowsHide: true }
);
process.exitCode = result.status ?? 1;
