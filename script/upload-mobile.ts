#! /usr/bin/env node

import { chmod, rm, writeFile } from 'node:fs/promises';
import { $ } from 'zx';

$.verbose = true;

const keyPath = 'WMA-upload.key';
try {
    await writeFile(keyPath, process.env.WMA_UPLOAD_KEY ?? '', { mode: 0o600 });
    await chmod(keyPath, 0o600);
    await $`pnpm dlx miniprogram-ci upload --pp ./mobile/ --pkp ${keyPath} --appid ${process
        .env.WMA_ID!} --uv ${process.env.PACKAGE_VERSION!}`;
} finally {
    await rm(keyPath, { force: true });
}
