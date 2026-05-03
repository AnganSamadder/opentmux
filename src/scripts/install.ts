#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();

interface ShellConfig {
  name: string;
  rcFile: string;
}

function detectShell(): ShellConfig {
  const shell = process.env.SHELL || '';

  if (process.platform === 'win32') {
    return {
      name: 'powershell',
      rcFile: path.join(HOME, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1'),
    };
  }

  if (shell.includes('zsh')) {
    return { name: 'zsh', rcFile: path.join(HOME, '.zshrc') };
  }
  if (shell.includes('bash')) {
    const bashProfile = path.join(HOME, '.bash_profile');
    return {
      name: 'bash',
      rcFile: fs.existsSync(bashProfile) ? bashProfile : path.join(HOME, '.bashrc'),
    };
  }
  if (shell.includes('fish')) {
    return { name: 'fish', rcFile: path.join(HOME, '.config', 'fish', 'config.fish') };
  }

  return { name: 'unknown', rcFile: path.join(HOME, '.profile') };
}

function getSnippet(shellName: string): string {
  const start = '# >>> opentmux >>>';
  const end = '# <<< opentmux <<<';

  if (shellName === 'powershell') {
    return `${start}
$env:OPENCODE_PORT="4096"
function opencode {
    opentmux $args
}
${end}`;
  }

  return `${start}
export OPENCODE_PORT=4096
alias opencode='opentmux'
${end}`;
}

function printInstructions(): void {
  const shell = detectShell();
  const reload = shell.name === 'powershell' ? `. ${shell.rcFile}` : `source ${shell.rcFile}`;

  console.log('');
  console.log('opentmux installed.');
  console.log('');
  console.log(`Detected shell: ${shell.name}`);
  console.log('');
  console.log(`To enable the 'opencode' wrapper, append this to ${shell.rcFile}:`);
  console.log('');
  console.log(getSnippet(shell.name));
  console.log('');
  console.log(`Then reload with: ${reload} (or restart your terminal).`);
  console.log('');
  console.log('Upgrading from a previous version? Remove any existing block bounded by');
  console.log("  '# >>> opentmux >>>' / '# <<< opentmux <<<'");
  console.log("  '# >>> opencode-agent-tmux >>>' / '# <<< opencode-agent-tmux <<<'");
  console.log("  '# >>> opencode-subagent-tmux >>>' / '# <<< opencode-subagent-tmux <<<'");
  console.log('before adding the new snippet.');
  console.log('');
}

try {
  printInstructions();
} catch (error) {
  console.error('');
  console.error('Failed to print install instructions:', (error as Error).message);
  console.error('');
  process.exit(0);
}
