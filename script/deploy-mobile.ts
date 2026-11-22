#! /usr/bin/env node

import { appendFile, readdir } from 'node:fs/promises';
import { $, fs, path } from 'zx';

$.verbose = true;

if (!process.env.WMA_ID) {
    console.log('WMA_ID is not configured; skipping the WeChat build.');
    process.exit(0);
}

await $`pnpm --dir mobile --pm-on-fail=ignore --shared-workspace-lockfile=false install --frozen-lockfile`;
await $`pnpm --dir mobile --pm-on-fail=ignore build-wx`;

const version = (await fs.readJSON('mobile/package.json')).version as string;
const files = await readdir('mobile/dist/wx');
if (!files.length) throw new Error('The mobile build produced no files.');

if (process.env.GITHUB_OUTPUT)
    await appendFile(process.env.GITHUB_OUTPUT, `package-version=${version}\n`);
