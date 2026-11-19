#! /usr/bin/env node

import { $ } from 'zx';

$.verbose = true;

const branch = process.env.DEFAULT_BRANCH!;
const documentPath = process.env.DOCUMENT_PATH!;
const issueNumber = process.env.ISSUE_NUMBER!;

await $`git config user.name github-actions[bot]`;
await $`git config user.email 41898282+github-actions[bot]@users.noreply.github.com`;
await $`git switch ${branch}`;
await $`git pull --ff-only origin ${branch}`;
await $`git add -- ${documentPath}`;

const staged = await $`git diff --cached --quiet`.nothrow();
if (staged.exitCode === 0) process.exit(0);

await $`git commit -m ${`docs: add requirements for issue #${issueNumber}`}`;

for (let attempt = 1; attempt <= 3; attempt++) {
    await $`git fetch origin ${branch}`;
    await $`git rebase ${`origin/${branch}`}`;
    const pushed = await $`git push origin ${`HEAD:${branch}`}`.nothrow();
    if (pushed.exitCode === 0) break;
    if (attempt === 3) throw pushed;
    await new Promise(resolve => setTimeout(resolve, attempt * 2000));
}
