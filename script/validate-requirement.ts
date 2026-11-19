#! /usr/bin/env node

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { $ } from 'zx';

$.verbose = true;

const planPath = join(
    process.env.RUNNER_TEMP!,
    'requirement-plan',
    'plan.json',
);
const plan = JSON.parse(await readFile(planPath, 'utf8'));
const document: unknown = plan.document;
const tasks: unknown = plan.tasks;
const allowedLabels = new Set(['server', 'browser', 'mobile']);

if (
    typeof document !== 'string' ||
    !document.trim() ||
    document.length > 100_000
) {
    throw new Error('The generated requirement document is invalid.');
}
if (!Array.isArray(tasks) || tasks.length > 50) {
    throw new Error('The generated task list is invalid.');
}

tasks.forEach((task, index) => {
    if (
        !task ||
        typeof task.title !== 'string' ||
        !task.title.trim() ||
        task.title.length > 200 ||
        typeof task.body !== 'string' ||
        !task.body.trim() ||
        task.body.length > 30_000 ||
        !Array.isArray(task.labels) ||
        task.labels.length === 0 ||
        task.labels.some((label: string) => !allowedLabels.has(label)) ||
        (task.dependsOn !== null &&
            (!Number.isInteger(task.dependsOn) ||
                task.dependsOn < 0 ||
                task.dependsOn >= index))
    ) {
        throw new Error(`Task ${index} is invalid.`);
    }
});

const issueBody = process.env.ISSUE_BODY ?? '';
const scopeMatches = [
    ...issueBody.matchAll(/^### Development scope[ \t]*\r?\n([^\r\n]+)/gm),
];
const scope = scopeMatches.at(-1)?.[1].trim();
if (!scope || !allowedLabels.has(scope)) {
    throw new Error('The issue must select a valid development scope.');
}

const slug = (process.env.ISSUE_TITLE ?? '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N} .()_-]+/gu, '-')
    .replace(/\.{2,}/g, '.')
    .trim()
    .replace(/^[ .-]+|[ .-]+$/g, '')
    .slice(0, 120);
const name = slug || `issue-${process.env.ISSUE_NUMBER}`;
const directory = join(process.cwd(), 'document');
let documentPath = join(directory, `${name}.md`);

if (existsSync(documentPath)) {
    documentPath = join(directory, `${name}-${process.env.ISSUE_NUMBER}.md`);
    if (existsSync(documentPath)) {
        throw new Error('A document for this issue already exists.');
    }
}

await mkdir(directory, { recursive: true });
await writeFile(documentPath, `${document.trimEnd()}\n`, 'utf8');
await writeFile('validated-tasks.json', JSON.stringify(tasks), 'utf8');
await $`echo ${`document_path=${documentPath.replace(
    `${process.cwd()}/`,
    '',
)}`} >> ${process.env.GITHUB_OUTPUT}`;
await $`echo ${`scope=${scope}`} >> ${process.env.GITHUB_OUTPUT}`;
