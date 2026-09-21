#!/usr/bin/env node
/**
 * Extract the authoritative tool schemas from cc-haha and generate the
 * contract-test snapshot.
 *
 * This runs LOCALLY (the cc-haha checkout is not available in CI). CI only
 * compares the shipped tool list against the committed snapshot.
 *
 * Steps:
 *   1. Transform cc-haha's windowsLegacyTools.ts (pure object literals, type
 *      -only imports) with esbuild and import it.
 *   2. Build its Windows tool list: platform win32, screenshot filtering
 *      none, coordinate mode pixels, teach mode off.
 *   3. Apply the ONLY allowed transformation (toolNames.ts mapping): tool
 *      names and the batch action enum.
 *   4. Drop teach tools (not part of the 22-tool surface).
 *   5. Normalize (strip descriptions, sort enums for order-insensitive
 *      comparison) and write tests/contract/__snapshots__/cc-haha-tools.json.
 *
 * Usage: node scripts/extract-tool-snapshots.mjs [ccHahaRoot]
 */

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDir, '..');
const ccHahaRoot = process.argv[2] ?? 'D:\\Trae项目\\cc-haha';
const ccHahaToolsFile = join(
  ccHahaRoot,
  'src',
  'vendor',
  'computer-use-mcp',
  'windowsLegacyTools.ts',
);
const toolNamesFile = join(projectRoot, 'src', 'core', 'toolNames.ts');
const snapshotFile = join(
  projectRoot,
  'tests',
  'contract',
  '__snapshots__',
  'cc-haha-tools.json',
);

/** Import a TypeScript source file after stripping its types. */
async function importTs(path) {
  const source = readFileSync(path, 'utf8');
  const { code } = esbuild.transformSync(source, {
    loader: 'ts',
    format: 'esm',
    target: 'node20',
  });
  const dataUrl = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  return import(dataUrl);
}

/** Recursively drop descriptions; sort enum arrays for stable comparison. */
function normalizeSchema(node) {
  if (Array.isArray(node)) return node.map(normalizeSchema);
  if (node !== null && typeof node === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === 'description') continue;
      if (key === 'enum' && Array.isArray(value)) {
        out[key] = [...value].sort();
        continue;
      }
      out[key] = normalizeSchema(value);
    }
    return out;
  }
  return node;
}

const names = await importTs(toolNamesFile);
const toolMap = names.CC_HAHA_TO_OUR_TOOL;
const batchActionMap = names.CC_HAHA_TO_OUR_BATCH_ACTION;

const legacy = await importTs(ccHahaToolsFile);
const tools = legacy.buildComputerUseTools(
  { screenshotFiltering: 'none', platform: 'win32' },
  'pixels',
);

const mapped = [];
for (const tool of tools) {
  const ourName = toolMap[tool.name];
  if (!ourName) {
    throw new Error(
      `cc-haha tool "${tool.name}" has no mapping in toolNames.ts — ` +
        'either it is a teach-mode tool (drop it) or add the mapping',
    );
  }
  const schema = normalizeSchema(tool.inputSchema);
  if (tool.name === 'computer_batch') {
    // Remap the batch action enum through the same table.
    schema.properties.actions.items.properties.action.enum =
      schema.properties.actions.items.properties.action.enum.map((name) => {
        const mappedName = batchActionMap[name];
        if (!mappedName) {
          throw new Error(`unmapped batch action "${name}"`);
        }
        return mappedName;
      });
  }
  mapped.push({
    name: ourName,
    ccHahaName: tool.name,
    inputSchema: schema,
  });
}

mapped.sort((a, b) => a.name.localeCompare(b.name));

const snapshot = {
  $comment:
    'Authoritative reference generated from cc-haha windowsLegacyTools.ts ' +
    'by scripts/extract-tool-snapshots.mjs. The only transformation applied ' +
    'is the tool-name mapping in src/core/toolNames.ts. Descriptions are ' +
    'stripped; enums are sorted (order-insensitive comparison).',
  source:
    'D:\\Trae项目\\cc-haha\\src\\vendor\\computer-use-mcp\\windowsLegacyTools.ts',
  coordinateMode: 'pixels',
  platform: 'win32',
  toolCount: mapped.length,
  tools: mapped,
};

mkdirSync(dirname(snapshotFile), { recursive: true });
writeFileSync(snapshotFile, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

console.log(`wrote ${snapshotFile}`);
console.log(`tools: ${mapped.length}`);
for (const tool of mapped) {
  console.log(`  ${tool.ccHahaName} -> ${tool.name}`);
}
