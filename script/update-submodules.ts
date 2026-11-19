#! /usr/bin/env node

import { $ } from 'zx';

$.verbose = true;

await $`git submodule update --remote --recursive`;
await $`git config user.name github-actions[bot]`;
await $`git config user.email 41898282+github-actions[bot]@users.noreply.github.com`;
await $`git add -- .gitmodules server browser mobile`;

const changes = await $`git diff --cached --quiet`.nothrow();
if (changes.exitCode === 0) {
    console.log('Submodules are already up to date.');
    process.exit(0);
}

const branch = 'automation/update-submodules';
await $`git switch --create ${branch}`;
await $`git commit -m "chore: update scaffold submodules"`;

const remote = await $`git fetch origin ${branch}`.nothrow();
if (remote.exitCode === 0) {
    const { stdout: expected } = await $`git rev-parse FETCH_HEAD`;
    await $`git push ${`--force-with-lease=refs/heads/${branch}:${expected.trim()}`} origin ${`HEAD:${branch}`}`;
} else {
    await $`git push origin ${`HEAD:${branch}`}`;
}

const { stdout: pullRequest } =
    await $`gh pr list --head ${branch} --json number --jq '.[0].number'`;
if (!pullRequest.trim()) {
    await $`gh pr create --base ${process.env
        .DEFAULT_BRANCH!} --head ${branch} --title "chore: update scaffold submodules" --body "Updates the server, browser, and mobile scaffold submodules." --reviewer idea2app/team-1`;
} else {
    await $`gh pr edit ${pullRequest.trim()} --add-reviewer idea2app/team-1`;
}
