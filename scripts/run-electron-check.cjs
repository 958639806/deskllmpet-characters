const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const script = process.argv[2];
if (!['smoke-renderer.js', 'check-blue-maid.js'].includes(script)) throw new Error('Choose a known Electron check script.');
const output = path.join(root, 'verification');
fs.mkdirSync(output, { recursive: true });
const stdoutPath = path.join(output, script + '.stdout.log');
const stderrPath = path.join(output, script + '.stderr.log');
const stdout = fs.openSync(stdoutPath, 'w');
const stderr = fs.openSync(stderrPath, 'w');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
let result;
try {
  result = spawnSync(require('electron'), [path.join(__dirname, script)], {
    cwd: root, env, stdio: ['ignore', stdout, stderr], windowsHide: true, timeout: 55000
  });
} finally { fs.closeSync(stdout); fs.closeSync(stderr); }
process.stdout.write(fs.readFileSync(stdoutPath, 'utf8'));
process.stderr.write(fs.readFileSync(stderrPath, 'utf8'));
if (result.error) console.error(result.error.message);
process.exit(result.status === null ? 1 : result.status);
