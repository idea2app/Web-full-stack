#! /usr/bin/env node

import { $ } from 'zx';

$.verbose = true;

const issueNumber = process.env.ISSUE_NUMBER!;
const action = process.env.ISSUE_ACTION!;

if (action === 'closed') {
    const { stdout } = await $`gh issue view ${issueNumber} --json subIssues`;
    const { subIssues } = JSON.parse(stdout);
    for (const issue of subIssues.filter(
        (candidate: { state: string }) => candidate.state === 'OPEN',
    )) {
        const { stdout: result } =
            await $`gh issue view ${issue.number} --json labels`;
        const { labels } = JSON.parse(result);
        if (
            labels.some(
                (label: { name: string }) => label.name === 'documentation',
            )
        ) {
            continue;
        }
        await $`gh issue edit ${issue.number} --add-assignee @copilot`;
    }
} else if (action === 'opened') {
    const { stdout } =
        await $`gh issue view ${issueNumber} --json labels,parent`;
    const issue = JSON.parse(stdout);
    if (
        issue.labels.some(
            (label: { name: string }) => label.name === 'documentation',
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
