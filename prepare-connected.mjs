import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const map = JSON.parse(readFileSync('.development/connected.json', 'utf8'));
if (map.projects.length) execFileSync('npm', ['install', '--no-save', '--package-lock=false', '--install-links=false',
  '--ignore-scripts', '--offline', '--no-audit', '--no-fund', ...map.projects.map(project => project.sourceRoot)], { stdio: 'inherit' });
