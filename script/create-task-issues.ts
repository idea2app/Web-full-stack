#! /usr/bin/env node

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'zx';

$.verbose = true;

const tasks = JSON.parse(await readFile('validated-tasks.json', 'utf8'));
const created: string[] = [];

for (const [index, task] of tasks.entries()) {
    for (const label of task.labels as string[]) {
        await $`gh label create ${label} --color 1D76DB --description ${`${label} scaffold work`} --force`;
    }

    const parent =
        task.dependsOn === null
            ? process.env.ISSUE_NUMBER!
            : created[task.dependsOn];
    if (!parent) throw new Error(`Task ${index} has no valid parent issue.`);

    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'task-issue-'));
    try {
        const bodyPath = join(temporaryDirectory, 'body.md');
        await writeFile(bodyPath, task.body, 'utf8');
        const { stdout } = await $`gh issue create --title ${
            task.title
        } --body-file ${bodyPath} --parent ${parent} ${task.labels.flatMap(
            (label: string) => ['--label', label],
        )}`;
        const match = stdout.trim().match(/\/issues\/(\d+)\s*$/);
        if (!match)
            throw new Error('Could not determine the created issue number.');
        const issueNumber = match[1];
        created.push(issueNumber);

        const { stdout: state } =
            await $`gh issue view ${parent} --json state --jq .state`;
        if (state.trim() === 'CLOSED') {
            await $`gh issue edit ${issueNumber} --add-assignee @copilot`;
        }
    } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
}
