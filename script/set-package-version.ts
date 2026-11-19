#! /usr/bin/env node

import { appendFile, readFile } from 'node:fs/promises';
import { $ } from 'zx';

$.verbose = false;

const { version } = JSON.parse(
    await readFile(process.env.PACKAGE_JSON_PATH ?? 'package.json', 'utf8'),
);
await appendFile(process.env.GITHUB_OUTPUT!, `current-version=${version}\n`);
