// Opens a VS Code Extension Development Host window with this extension loaded.
// Used by the Aspire AppHost; for debugging with breakpoints use F5 instead.
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const child = spawn('code', ['--new-window', `--extensionDevelopmentPath=${extensionDir}`], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
child.on('error', (err) => {
  console.error(`Could not start VS Code: ${err.message}`);
  console.error('Install the "code" command from VS Code: Command Palette > "Shell Command: Install \'code\' command in PATH".');
  process.exitCode = 1;
});
child.on('exit', (code) => {
  if (code === 0) {
    console.log('Extension Development Host window opened.');
  }
  process.exitCode = code ?? 1;
});
