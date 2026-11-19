#! /usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { $ } from 'zx';

$.verbose = true;

await mkdir('build', { mode: 0o700 });
await $`mv ${process.env
    .ARTIFACT_PATH!} browser/docker-compose.yml browser/start.sh build/`;

const composePath = 'build/docker-compose.yml';
const compose = await readFile(composePath, 'utf8');
const marker = '  next-bootstrap-ts:\n';
if (!compose.includes(marker)) {
    throw new Error('Could not locate the browser service.');
}
await writeFile(
    composePath,
    compose.replace(marker, `${marker}    env_file:\n      - .env.local\n`),
);
await writeFile('build/runtime.env', process.env.ENV_FILE ?? '', {
    mode: 0o600,
});
