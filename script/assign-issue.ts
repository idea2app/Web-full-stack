#! /usr/bin/env node

import { $, argv } from 'zx';

import type { AIEngine } from './ai-cli.ts';

$.verbose = true;

const issueNumber = String(argv._[0] ?? '');
const action = String(argv._[1] ?? '');
const defaultBranch = String(argv._[2] ?? '');

if (!issueNumber || !['opened', 'closed'].includes(action) || !defaultBranch)
    throw new Error('Issue number, action, and default branch are required.');

const engineByLabel: Record<string, AIEngine> = {
    'agent-openai-codex': 'openai-codex',
    'agent-gemini-cli': 'gemini-cli',
    'agent-claude-code': 'claude-code',
    'agent-qoder-cli': 'qoder-cli',
    'agent-kimi-cli': 'kimi-cli',
    'agent-kilo-cli': 'kilo-cli',
};

async function routeIssue(number: number | string, labels: { name: string }[]) {
    if (labels.some(({ name }) => name === 'documentation')) return;

    const engine =
        labels.map(({ name }) => engineByLabel[name]).find(Boolean) ??
        'copilot';

    if (engine === 'copilot') {
        await $`gh issue edit ${number} --add-assignee @copilot`;
    } else {
        await $`gh workflow run implement-issue.yml --ref ${defaultBranch} -f ${`issue_number=${number}`}`;
    }
}

if (action === 'opened') {
    const { stdout } =
        await $`gh issue view ${issueNumber} --json labels,parent`;
    const issue = JSON.parse(stdout);
    if (
        issue.labels.some(
            ({ name }: { name: string }) => name === 'documentation',
        )
    )
        process.exit(0);

    if (issue.parent) {
        const { stdout: parent } =
            await $`gh issue view ${issue.parent.number} --json state,labels`;
        const parentIssue = JSON.parse(parent);
        const parentIsDocumentation = parentIssue.labels.some(
            ({ name }: { name: string }) => name === 'documentation',
        );
        if (!parentIsDocumentation && parentIssue.state !== 'CLOSED') {
            console.log(
                `Parent issue #${issue.parent.number} is not closed; assignment is deferred.`,
            );
            process.exit(0);
        }
    }
    await routeIssue(issueNumber, issue.labels);
} else {
    const { stdout } = await $`gh issue view ${issueNumber} --json subIssues`;
    const { subIssues } = JSON.parse(stdout);

    for (const { number } of subIssues.filter(
        ({ state }: { state: string }) => state === 'OPEN',
    )) {
        const { stdout: result } =
            await $`gh issue view ${number} --json labels`;
        await routeIssue(
            number,
            JSON.parse(result).labels as { name: string }[],
        );
    }
}
