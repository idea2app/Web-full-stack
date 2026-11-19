#! /usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { $ } from 'zx';

$.verbose = true;

await mkdir('build', { mode: 0o700 });
await $`mv ${process.env
    .ARTIFACT_PATH!} server/docker-compose.yml server/start.sh build/`;
await writeFile(
    'build/runtime.env',
    `APP_SECRET=${process.env.APP_SECRET ?? ''}\n`,
    {
        mode: 0o600,
    },
);
