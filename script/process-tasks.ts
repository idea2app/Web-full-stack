#! /usr/bin/env node

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { $, argv, fs, path } from 'zx';
import { parse, stringify } from 'yaml';
import type { AIEngine } from './ai-cli.ts';

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
    ) {
        continue;
    }

    const tasksPath = path.join('documents', directory, 'tasks.yml');
    if (!(await fs.pathExists(tasksPath))) continue;
    const plan = parse(await fs.readFile(tasksPath, 'utf8'));
    if (!plan || plan.issue !== Number(number)) {
        throw new Error(
            `Invalid task plan for documentation issue #${number}.`,
        );
    }
    if (
        !Array.isArray(plan.tasks) ||
        plan.tasks.length < 1 ||
        plan.tasks.length > 10 ||
        !validEngines.has(plan.engine) ||
        !Array.isArray(plan.scopes) ||
        !plan.scopes.length ||
        plan.scopes.some((scope: string) => !validScopes.has(scope)) ||
        !plan.tasks.every(
            (task: any, index: number) =>
                task &&
                typeof task.title === 'string' &&
                !!task.title.trim() &&
                task.title.length <= 200 &&
                typeof task.body === 'string' &&
                !!task.body.trim() &&
                task.body.length <= 30_000 &&
                Array.isArray(task.labels) &&
                task.labels.length > 0 &&
                task.labels.every(
                    (label: string) =>
                        validScopes.has(label) && plan.scopes.includes(label),
                ) &&
                (task.dependsOn === null ||
                    (Number.isInteger(task.dependsOn) &&
                        task.dependsOn >= 0 &&
                        task.dependsOn < index)) &&
                (task.issue === null ||
                    (Number.isInteger(task.issue) && task.issue > 0)) &&
                (task.delegated === undefined ||
                    typeof task.delegated === 'boolean') &&
                (task.delegated !== true ||
                    (Number.isInteger(task.issue) && task.issue > 0)),
        ) ||
        !['pending', 'processing', 'completed'].includes(plan.status)
    ) {
        throw new Error(
            `Invalid task plan for documentation issue #${number}.`,
        );
    }
    if (plan.status === 'completed') continue;

    const taskMarker = (index: number) =>
        `<!-- requirement-task:${number}:${index} -->`;
    let existingChildren: { number: number; body: string }[] | undefined;

    for (const [index, task] of plan.tasks.entries()) {
        if (!task.issue) {
            if (!existingChildren) {
                const { stdout: childIssues } =
                    await $`gh issue view ${number} --json subIssues`;
                existingChildren = await Promise.all(
                    JSON.parse(childIssues).subIssues.map(
                        async ({ number: childNumber }: { number: number }) => {
                            const { stdout: child } =
                                await $`gh issue view ${childNumber} --json body`;
                            return {
                                number: childNumber,
                                body: JSON.parse(child).body,
                            };
                        },
                    ),
                );
            }

            const existing = existingChildren.find(({ body }) =>
                body.includes(taskMarker(index)),
            );
            if (existing) {
                task.issue = existing.number;
                await fs.outputFile(tasksPath, stringify(plan), 'utf8');
                changed = true;
            } else {
                const directory = await mkdtemp(
                    path.join(tmpdir(), 'task-issue-'),
                );
                try {
                    const labels = [
                        ...new Set([...task.labels, `agent-${plan.engine}`]),
                    ];
                    for (const label of labels) {
                        await $`gh label create ${label} --color 1D76DB --description ${`${label} scaffold work`} --force`;
                    }

                    const bodyPath = path.join(directory, 'body.md');
                    const dependsOn =
                        task.dependsOn === null
                            ? ''
                            : `\n\nDepends on task #${
                                  plan.tasks[task.dependsOn].issue
                              }.`;
                    await writeFile(
                        bodyPath,
                        `${taskMarker(index)}\n\n${task.body}${dependsOn}`,
                        'utf8',
                    );
                    const { stdout: url } = await $`gh issue create --title ${
                        task.title
                    } --body-file ${bodyPath} --parent ${number} ${labels.flatMap(
                        (label: string) => ['--label', label],
                    )}`;
                    const [, createdIssue] =
                        url.trim().match(/\/issues\/(\d+)\s*$/) || [];
                    if (!createdIssue)
                        throw new Error(
                            'Could not determine the created issue number.',
                        );
                    task.issue = Number(createdIssue);
                    await fs.outputFile(tasksPath, stringify(plan), 'utf8');
                    changed = true;
                } catch (error) {
                    console.error(
                        `Could not create task ${index} for issue #${number}.`,
                    );
                    throw error;
                } finally {
                    await rm(directory, { recursive: true, force: true });
                }
            }
        }

        if (!task.delegated) {
            const engine = plan.engine as AIEngine;
            let delegated = false;
            if (engine === 'copilot') {
                delegated =
                    (
                        await $`gh issue edit ${task.issue} --add-assignee @copilot`.nothrow()
                    ).exitCode === 0;
            } else {
                delegated =
                    (
                        await $`gh workflow run implement-issue.yml --ref ${defaultBranch} -f ${`issue_number=${task.issue}`}`.nothrow()
                    ).exitCode === 0;
            }
            task.delegated = delegated;
            await fs.outputFile(tasksPath, stringify(plan), 'utf8');
            changed = true;
        }
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
