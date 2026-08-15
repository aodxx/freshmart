import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const repositoryFiles = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  {
    cwd: root,
    encoding: 'utf8'
  }
).split('\0').filter(Boolean);
const errors = [];

const requiredFiles = [
  'README.md',
  'CONTRIBUTING.md',
  'PROGRESS.md',
  'docs/DEVELOPMENT.md',
  'index.html',
  'admin/index.html',
  'js/config.js'
];

for (const file of requiredFiles) {
  if (!existsSync(resolve(root, file))) errors.push(`Missing required file: ${file}`);
}

const junkNames = new Set(['.DS_Store', 'Thumbs.db']);
const junkExtensions = new Set(['.bak', '.log', '.rar', '.swp', '.temp', '.tmp', '.zip', '.7z']);
const junkDirectories = /(^|\/)(coverage|dist|node_modules|\.supabase)(\/|$)/;

for (const file of repositoryFiles) {
  const baseName = file.split('/').at(-1);
  if (junkNames.has(baseName) || junkExtensions.has(extname(file).toLowerCase()) || junkDirectories.test(file)) {
    errors.push(`Generated/junk file in repository: ${file}`);
  }
  if (/^\.env(?:\.|$)/.test(baseName) && baseName !== '.env.example') {
    errors.push(`Environment file in repository: ${file}`);
  }
}

const staticReference = /\b(?:href|src)=["']([^"']+)["']/g;
const skippedReference = /^(?:#|\/\/|data:|https?:|javascript:|mailto:|tel:)/i;

for (const file of repositoryFiles.filter(file => file.endsWith('.html'))) {
  const source = readFileSync(resolve(root, file), 'utf8');
  for (const match of source.matchAll(staticReference)) {
    const reference = match[1];
    if (skippedReference.test(reference) || reference.includes('${')) continue;
    const cleanReference = decodeURIComponent(reference.split(/[?#]/, 1)[0]);
    if (!cleanReference) continue;
    const target = resolve(root, dirname(file), cleanReference);
    if (!target.startsWith(`${root}${sep}`) || !existsSync(target)) {
      errors.push(`Broken local reference in ${file}: ${reference}`);
    }
  }
}

const textExtensions = new Set(['.css', '.html', '.js', '.json', '.md', '.mjs', '.sql', '.ts', '.yml']);
const assignedSecret = /\b(?:LINE_CHANNEL_ACCESS_TOKEN|LINE_CHANNEL_SECRET|SUPABASE_SERVICE_ROLE_KEY|PRIVATE_KEY|API_SECRET)\s*[:=]\s*["'`]([^"'`\s]+)["'`]/g;

for (const file of repositoryFiles.filter(file => textExtensions.has(extname(file)))) {
  const source = readFileSync(resolve(root, file), 'utf8');
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(source)) {
    errors.push(`Private key material found in ${file}`);
  }
  for (const match of source.matchAll(assignedSecret)) {
    if (!/^(?:example|placeholder|replace-me|your-)/i.test(match[1])) {
      errors.push(`Possible committed secret in ${file}: ${match[0].split(/[:=]/, 1)[0].trim()}`);
    }
  }
}

if (errors.length) {
  console.error('Repository check failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Repository check passed (${repositoryFiles.length} source files).`);
}
