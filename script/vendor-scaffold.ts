#! /usr/bin/env node

import { $ } from 'zx';

$.verbose = true;

const scope = process.env.SCOPE!;
const issueNumber = process.env.ISSUE_NUMBER!;
const branch = process.env.DEFAULT_BRANCH!;

const workflowsByScope: Record<string, string[]> = {
    server: ['server-deploy-production.yml'],
    browser: ['browser-main.yml', 'browser-deploy-production.yml'],
    mobile: ['mobile-main.yml'],
};
const workflows = workflowsByScope[scope];
if (!workflows) throw new Error('Invalid scaffold scope.');

await $`git switch ${branch}`;
await $`git pull --ff-only origin ${branch}`;
const { stdout: mode } = await $`git ls-files -s -- ${scope}`;
if (mode.trim().split(/\s+/)[0] !== '160000') {
    console.log(`${scope} is already stored as regular files.`);
    process.exit(0);
}

await $`git submodule update --init -- ${scope}`;
await $`git rm --cached -- ${scope}`;
await $`git config -f .gitmodules --remove-section ${`submodule.${scope}`}`;
await $`rm -- ${`${scope}/.git`}`;
await $`git add -f -- .gitmodules ${scope}`;
await $`git config user.name github-actions[bot]`;
await $`git config user.email 41898282+github-actions[bot]@users.noreply.github.com`;
await $`git commit -m ${`chore: vendor ${scope} scaffold for issue #${issueNumber}`}`;

for (let attempt = 1; attempt <= 3; attempt++) {
    await $`git fetch origin ${branch}`;
    await $`git rebase ${`origin/${branch}`}`;
    const pushed = await $`git push origin ${`HEAD:${branch}`}`.nothrow();
    if (pushed.exitCode === 0) break;
    if (attempt === 3) throw pushed;
    await new Promise(resolve => setTimeout(resolve, attempt * 2000));
}

for (const workflow of workflows) {
    await $`gh workflow run ${workflow} --ref ${branch}`;
}
