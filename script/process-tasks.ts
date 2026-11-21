#! /usr/bin/env node

import 'array-unique-proposal';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { $, argv, fs, path } from 'zx';
import { parse, stringify } from 'yaml';

import type { AIEngine } from './ai-cli.ts';
import {
    isValidStoredRequirementTask,
    type StoredRequirementTask,
} from './requirement-task.ts';

$.verbose = true;

const defaultBranch = String(argv['default-branch'] ?? '');
if (!defaultBranch)
    throw new Error(
        'The default branch must be provided as a command-line argument.',
    );
const validEngines = new Set([
    'copilot',
    'claude-code',
    'gemini-cli',
    'openai-codex',
    'kimi-cli',
]);
const validScopes = new Set(['server', 'browser', 'mobile']);

interface RequirementPlan {
    engine: string;
    tasks: StoredRequirementTask[];
}

interface ExistingChildIssue {
    number: number;
    body: string;
}

interface TaskIssueContext {
    issueNumber: string;
    tasksPath: string;
    plan: RequirementPlan;
    existingChildren?: ExistingChildIssue[];
}

const taskMarker = (issueNumber: string, index: number) =>
    `<!-- requirement-task:${issueNumber}:${index} -->`;

async function fetchIssueBody(number: number): Promise<ExistingChildIssue> {
    const { stdout } = await $`gh issue view ${number} --json body`;

    return { number, body: JSON.parse(stdout).body };
}

async function loadExistingChildren(
    issueNumber: string,
): Promise<ExistingChildIssue[]> {
    const { stdout } = await $`gh issue view ${issueNumber} --json subIssues`;

    const issueNumbers: number[] = JSON.parse(stdout).subIssues.map(
        ({ number }: { number: number }) => number,
    );
    return Promise.all(issueNumbers.map(fetchIssueBody));
}

async function ensureTaskIssue(
    context: TaskIssueContext,
    index: number,
    task: StoredRequirementTask,
): Promise<boolean> {
    if (task.issue) return false;

    if (!context.existingChildren)
        context.existingChildren = await loadExistingChildren(
            context.issueNumber,
        );
    const existing = context.existingChildren.find(({ body }) =>
        body.includes(taskMarker(context.issueNumber, index)),
    );
    if (existing) {
        task.issue = existing.number;
        await fs.outputFile(context.tasksPath, stringify(context.plan), 'utf8');
        return true;
    }

    const directory = await mkdtemp(path.join(tmpdir(), 'task-issue-'));
    try {
        const labels = [
            ...task.labels,
            `agent-${context.plan.engine}`,
        ].uniqueBy();

        for (const label of labels)
            await $`gh label create ${label} --color 1D76DB --description ${`${label} scaffold work`} --force`;

        const bodyPath = path.join(directory, 'body.md');
        const dependsOn =
            task.dependsOn === null
                ? ''
                : `\n\nDepends on task #${
                      context.plan.tasks[task.dependsOn].issue
                  }.`;
        await writeFile(
            bodyPath,
            `${taskMarker(context.issueNumber, index)}\n\n${task.body}${dependsOn}`,
            'utf8',
        );
        const { stdout: url } = await $`gh issue create --title ${
            task.title
        } --body-file ${bodyPath} --parent ${context.issueNumber} ${labels.flatMap(
            (label: string) => ['--label', label],
        )}`;
        const [, createdIssue] = url.trim().match(/\/issues\/(\d+)\s*$/) || [];
        if (!createdIssue)
            throw new Error('Could not determine the created issue number.');

        task.issue = Number(createdIssue);
        await fs.outputFile(context.tasksPath, stringify(context.plan), 'utf8');
        return true;
    } catch (error) {
        console.error(
            `Could not create task ${index} for issue #${context.issueNumber}.`,
        );
        throw error;
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

const entries: { isDirectory: () => boolean; name: string }[] =
    !(await fs.pathExists('documents'))
        ? []
        : await fs.readdir('documents', { withFileTypes: true });
const candidates = entries
    .filter((entry: { isDirectory: () => boolean; name: string }) =>
        entry.isDirectory(),
    )
    .map((entry: { name: string }) => ({
        directory: entry.name,
        number: entry.name.match(/-(\d+)$/)?.[1],
    }))
    .filter(
        (candidate): candidate is { directory: string; number: string } =>
            !!candidate.number,
    );
let changed = false;

for (const { directory, number } of candidates) {
    const { stdout } = await $`gh issue view ${number} --json state,labels`;
    const issue = JSON.parse(stdout);
    if (
        issue.state !== 'CLOSED' ||
        !issue.labels.some(
            ({ name }: { name: string }) => name === 'documentation',
        )
    )
        continue;

    const tasksPath = path.join('documents', directory, 'tasks.yml');
    if (!(await fs.pathExists(tasksPath))) continue;

    const plan = parse(await fs.readFile(tasksPath, 'utf8'));
    if (!plan || plan.issue !== Number(number))
        throw new Error(
            `Invalid task plan for documentation issue #${number}.`,
        );
    const isValidStoredTask = (task: unknown, index: number) =>
        isValidStoredRequirementTask(task, index, plan.scopes);
    if (
        !Array.isArray(plan.tasks) ||
        plan.tasks.length < 1 ||
        plan.tasks.length > 10 ||
        !validEngines.has(plan.engine) ||
        !Array.isArray(plan.scopes) ||
        !plan.scopes.length ||
        plan.scopes.some((scope: string) => !validScopes.has(scope)) ||
        !plan.tasks.every(isValidStoredTask) ||
        !['pending', 'processing', 'completed'].includes(plan.status)
    )
        throw new Error(
            `Invalid task plan for documentation issue #${number}.`,
        );
    if (plan.status === 'completed') continue;

    const taskContext: TaskIssueContext = {
        issueNumber: number,
        tasksPath,
        plan,
    };

    for (const [index, task] of plan.tasks.entries()) {
        if (
            await ensureTaskIssue(
                taskContext,
                index,
                task as StoredRequirementTask,
            )
        )
            changed = true;

        if (task.delegated) continue;

        const engine = plan.engine as AIEngine;
        let delegated = false;

        if (engine === 'copilot') {
            const { exitCode } =
                await $`gh issue edit ${task.issue} --add-assignee @copilot`.nothrow();

            delegated = exitCode === 0;
        } else {
            const { exitCode } =
                await $`gh workflow run implement-issue.yml --ref ${defaultBranch} -f ${`issue_number=${task.issue}`}`.nothrow();

            delegated = exitCode === 0;
        }
        task.delegated = delegated;
        await fs.outputFile(tasksPath, stringify(plan), 'utf8');
        changed = true;
    }

    if (
        !plan.tasks.some(
            (task: { issue?: number; delegated?: boolean }) =>
                !task.issue || !task.delegated,
        )
    ) {
        plan.status = 'completed';
        await fs.outputFile(tasksPath, stringify(plan), 'utf8');
        changed = true;
    }
}

if (!changed) process.exit(0);
