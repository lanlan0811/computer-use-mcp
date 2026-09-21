import { readFileSync } from 'node:fs';

const yaml = readFileSync('.github/workflows/release.yml', 'utf8');
if (yaml.includes('\t')) {
  console.error('TABS FOUND');
  process.exit(1);
}
const required = [
  'name: release',
  'tags:',
  'v*',
  'runs-on: windows-latest',
  'npm publish --provenance',
  'gh release create',
  'NPM_TOKEN',
  'id-token: write',
];
for (const key of required) {
  if (!yaml.includes(key)) {
    console.error(`MISSING: ${key}`);
    process.exit(1);
  }
}
console.log('release.yml structure OK');

// Simulate the workflow's release-notes extraction against CHANGELOG.md.
const version = '0.1.0';
const changelog = readFileSync('CHANGELOG.md', 'utf8');
const start = changelog.indexOf(`## [${version}]`);
if (start < 0) {
  console.error('no changelog entry');
  process.exit(1);
}
const end = changelog.indexOf('## [', start + 5);
const notes = (
  end < 0 ? changelog.slice(start) : changelog.slice(start, end)
).trimEnd();
console.log(
  `notes extraction OK (${notes.length} chars): ${notes.split('\n')[0]}`,
);

// Simulate the tarball whitelist expectations against the current pack list.
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const expectedInTarball = [
  'dist/index.js',
  'dist/worker/entry.js',
  'assets/icon.svg',
  'scripts/postinstall.mjs',
  'README.md',
  'LICENSE',
  'NOTICE',
  'CHANGELOG.md',
];
console.log('files whitelist:', JSON.stringify(pkg.files));
for (const file of expectedInTarball) {
  const top = file.split('/')[0];
  const covered = pkg.files.some(
    (entry) => entry === file || entry === top + '/' || file.startsWith(entry),
  );
  if (!covered) {
    console.error(`whitelist misses: ${file}`);
    process.exit(1);
  }
}
console.log('tarball whitelist expectations OK');
