#! /usr/bin/env node

import { $ } from 'zx';

$.verbose = true;

const [issueNumber, action] = process.argv.slice(2);
if (!issueNumber || !action)
    throw new Error('Issue number and action are required.');

if (action === 'closed') {
    const { stdout } = await $`gh issue view ${issueNumber} --json subIssues`;
    const { subIssues } = JSON.parse(stdout);
    for (const { number, state } of subIssues.filter(
        ({ state }: { state: string }) => state === 'OPEN',
    )) {
        const { stdout: result } =
            await $`gh issue view ${number} --json labels`;
        const { labels } = JSON.parse(result);
        if (
            labels.some(
                ({ name }: { name: string }) => name === 'documentation',
            ) ||
            !labels.some(
                ({ name }: { name: string }) => name === 'agent-copilot',
            )
        ) {
            continue;
        }
        await $`gh issue edit ${number} --add-assignee @copilot`;
    }
} else if (action === 'opened') {
    const { stdout } =
        await $`gh issue view ${issueNumber} --json labels,parent`;
    const issue = JSON.parse(stdout);
    if (
        issue.labels.some(
            ({ name }: { name: string }) => name === 'documentation',
        ) ||
        !issue.labels.some(
            ({ name }: { name: string }) => name === 'agent-copilot',
        )
    ) {
        process.exit(0);
    }
    if (issue.parent) {
        const { stdout: state } =
            await $`gh issue view ${issue.parent.number} --json state --jq .state`;
        if (state.trim() !== 'CLOSED') {
            console.log(
                `Parent issue #${issue.parent.number} is not closed; assignment is deferred.`,
            );
            process.exit(0);
        }
    }
    await $`gh issue edit ${issueNumber} --add-assignee @copilot`;
}
