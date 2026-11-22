#! /usr/bin/env node

import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { $, fs, path } from 'zx';

$.verbose = true;

const appID = process.env.WMA_ID;
const uploadKey = process.env.WMA_UPLOAD_KEY;
if (!appID || !uploadKey)
    throw new Error('WMA_ID and WMA_UPLOAD_KEY are required.');

delete process.env.WMA_UPLOAD_KEY;

const version = (await fs.readJSON('mobile/package.json')).version as string;
const keyDirectory = await mkdtemp(path.join(tmpdir(), 'wechat-upload-'));
const keyPath = path.join(keyDirectory, 'WMA-upload.key');

try {
    await writeFile(keyPath, uploadKey, { mode: 0o600 });
    await chmod(keyPath, 0o600);
    await $`pnpm dlx miniprogram-ci@2.1.31 upload --pp ./mobile/ --pkp ${keyPath} --appid ${appID} --uv ${version}`;
} finally {
    await rm(keyDirectory, { recursive: true, force: true });
}
