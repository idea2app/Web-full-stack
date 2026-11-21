#! /usr/bin/env node

import { rm } from 'node:fs/promises';
import { $, argv } from 'zx';

$.verbose = true;

const scopes = String(argv.scopes ?? '')
    .split(/\s+/)
    .filter(Boolean);
const allowedScopes = new Set(['server', 'browser', 'mobile']);

for (const scope of new Set(scopes)) {
    if (!allowedScopes.has(scope)) throw new Error('Invalid scaffold scope.');

    const { stdout } = await $`git ls-files -s -- ${scope}`;
    if (stdout.trim().split(/\s+/)[0] !== '160000') continue;

    await $`git submodule update --init -- ${scope}`;
    await $`git rm --cached -- ${scope}`;
    await $`git config -f .gitmodules --remove-section ${`submodule.${scope}`}`;
    await rm(`${scope}/.git`, { force: true });
    await $`git add -f -- .gitmodules ${scope}`;
}
