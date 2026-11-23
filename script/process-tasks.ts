#! /usr/bin/env node

import 'array-unique-proposal';
import { $, argv, fs, os, path } from 'zx';
import { parse, stringify } from 'yaml';

import {
    isCompletedIssue,
    routeIssueIfReady,
    taskDependencies,
} from './utility.ts';
import {
    RequirementPlanSchema,
    parseIssueReferences,
    type RequirementPlan,
    type StoredRequirementTask,
} from './schema.ts';

$.verbose = true;

const defaultBranch = String(argv['default-branch'] ?? '');
if (!defaultBranch)
    throw new Error(
        'The default branch must be provided as a command-line argument.',
    );
interface ExistingChildIssue {
    number: number;
    body: string;
    url: string;
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
    const { stdout } = await $`gh issue view ${number} --json body,url`;
    const { body, url } = JSON.parse(stdout);

    return { number, body, url };
}

async function loadExistingChildren(
    issueNumber: string,
): Promise<ExistingChildIssue[]> {
    const { stdout } = await $`gh issue view ${issueNumber} --json subIssues`;

    const issueNumbers = parseIssueReferences(stdout, 'subIssues').map(
        ({ number }) => number,
    );
    return Promise.all(issueNumbers.map(fetchIssueBody));
}

async function ensureTaskIssue(
    context: TaskIssueContext,
    index: number,
    task: StoredRequirementTask,
): Promise<boolean> {
    if (task.issue) {
        if (task.url) return false;

        const existing = await fetchIssueBody(task.issue);
        task.url = existing.url;
        await fs.outputFile(context.tasksPath, stringify(context.plan), 'utf8');
        return true;
    }

    if (!context.existingChildren)
        context.existingChildren = await loadExistingChildren(
            context.issueNumber,
        );
    const existing = context.existingChildren.find(({ body }) =>
        body.includes(taskMarker(context.issueNumber, index)),
    );
    if (existing) {
        task.issue = existing.number;
        task.url = existing.url;
        await fs.outputFile(context.tasksPath, stringify(context.plan), 'utf8');
        return true;
    }

    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'task-issue-'));
    try {
        const labels = [
            ...task.labels,
            `agent-${context.plan.engine}`,
        ].uniqueBy();

        for (const label of labels)
            await $`gh label create ${label} --color 1D76DB --description ${`${label} scaffold work`} --force`;

        const bodyPath = path.join(directory, 'body.md');
        await fs.writeFile(
            bodyPath,
            `${taskMarker(context.issueNumber, index)}\n\n${task.body}`,
            'utf8',
        );
        const dependencies = taskDependencies(task).map(
            dependency => context.plan.tasks[dependency].issue,
        );
        if (dependencies.some(number => !number))
            throw new Error(`Missing prerequisite issue for task ${index}.`);

        const blockedBy = dependencies.length
            ? ['--blocked-by', dependencies.join(',')]
            : [];
        const { stdout } = await $`gh issue create --title ${
            task.title
        } --body-file ${bodyPath} --parent ${context.issueNumber} ${blockedBy} ${labels.flatMap(
            (label: string) => ['--label', label],
        )}`;
        const url = stdout.trim();
        const [, createdIssue] = url.match(/\/issues\/(\d+)\s*$/) || [];
        if (!createdIssue)
            throw new Error('Could not determine the created issue number.');

        task.issue = Number(createdIssue);
        task.url = url;
        await fs.outputFile(context.tasksPath, stringify(context.plan), 'utf8');
        return true;
    } catch (error) {
        console.error(
            `Could not create task ${index} for issue #${context.issueNumber}.`,
        );
        throw error;
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
}

async function ensureTaskDependencies(
    context: TaskIssueContext,
    task: StoredRequirementTask,
): Promise<void> {
    const dependencies = taskDependencies(task).map(
        index => context.plan.tasks[index],
    );
    if (!dependencies.length) return;
    if (
        !task.issue ||
        dependencies.some(dependency => !dependency.issue || !dependency.url)
    )
        throw new Error('Task or prerequisite issue details are missing.');

    const { stdout } = await $`gh issue view ${task.issue} --json blockedBy`;
    const existing = new Set(
        parseIssueReferences(stdout, 'blockedBy').map(({ url }) => url),
    );
    const missing = dependencies.filter(
        dependency => dependency.url && !existing.has(dependency.url),
    );
    if (missing.length)
        await $`gh issue edit ${task.issue} --add-blocked-by ${missing.map(dependency => dependency.issue).join(',')}`;
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
    const { stdout } =
        await $`gh issue view ${number} --json state,stateReason,labels,url`;
    const issue = JSON.parse(stdout);
    if (
        !isCompletedIssue(issue) ||
        !issue.labels.some(
            ({ name }: { name: string }) => name === 'documentation',
        )
    )
        continue;

    const tasksPath = path.join('documents', directory, 'tasks.yml');
    if (!(await fs.pathExists(tasksPath))) continue;

    const parsedPlan = RequirementPlanSchema.safeParse(
        parse(await fs.readFile(tasksPath, 'utf8')),
    );
    if (!parsedPlan.success)
        throw new Error(
            `Invalid task plan for documentation issue #${number}: ${parsedPlan.error.message}`,
        );
    const plan = parsedPlan.data;
    if (plan.issue !== Number(number))
        throw new Error(
            `Invalid task plan for documentation issue #${number}: issue number does not match.`,
        );
    const recoveredPlanUrl = !plan.url && URL.canParse(issue.url);
    if (recoveredPlanUrl) plan.url = issue.url;
    if (typeof plan.url !== 'string' || !URL.canParse(plan.url))
        throw new Error(
            `Invalid task plan for documentation issue #${number}: a valid URL is required.`,
        );
    if (recoveredPlanUrl) {
        await fs.outputFile(tasksPath, stringify(plan), 'utf8');
        changed = true;
    }
    if (plan.status !== 'pending') continue;

    const taskContext: TaskIssueContext = {
        issueNumber: number,
        tasksPath,
        plan,
    };

    for (const [index, task] of plan.tasks.entries()) {
        if (await ensureTaskIssue(taskContext, index, task)) changed = true;

        await ensureTaskDependencies(taskContext, task);
    }

    for (const task of plan.tasks) {
        if (task.delegated || !task.issue) continue;

        if (await routeIssueIfReady(task.issue, defaultBranch)) {
            task.delegated = true;
            await fs.outputFile(tasksPath, stringify(plan), 'utf8');
            changed = true;
        }
    }
    plan.status = 'completed';
    await fs.outputFile(tasksPath, stringify(plan), 'utf8');
    changed = true;
}

if (!changed) process.exit(0);
