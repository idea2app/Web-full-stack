#! /usr/bin/env node

import { $, argv, fs } from 'zx';

import { removeRootHiddenDirectories } from './utility.ts';

$.verbose = true;

const scopes = String(argv.scopes ?? '')
    .split(/\s+/)
    .filter(Boolean);
const allowedScopes = new Set(['server', 'browser', 'mobile']);
let localized = false;

for (const scope of new Set(scopes)) {
    if (!allowedScopes.has(scope)) throw new Error('Invalid scaffold scope.');

    const { stdout } = await $`git ls-files -s -- ${scope}`;
    if (stdout.trim().split(/\s+/)[0] !== '160000') continue;

    await $`git submodule update --init -- ${scope}`;
    await $`git rm --cached -- ${scope}`;
    await $`git config -f .gitmodules --remove-section ${`submodule.${scope}`}`;
    await fs.rm(`${scope}/.git`, { recursive: true, force: true });
    await fs.rm(`${scope}/pnpm-lock.yaml`, { force: true });
    await removeRootHiddenDirectories(scope);
    await $`git add -f -- .gitmodules ${scope}`;
    localized = true;
}

if (localized) await $`pnpm -r i --no-frozen-lockfile`;
