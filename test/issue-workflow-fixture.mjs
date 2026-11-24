import { mock } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    mkdtempSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse, stringify } from 'yaml';
import * as zx from 'zx';

const root = process.cwd();
const temporary = mkdtempSync(join(tmpdir(), 'issue-routing-test-'));
const argv = { 'default-branch': 'main', _: [] };
const issueUrl = number => `https://github.com/example/repo/issues/${number}`;
const issues = new Map([
    [
        1,
        {
            number: 1,
            state: 'CLOSED',
            stateReason: 'COMPLETED',
            labels: [{ name: 'documentation' }],
            url: issueUrl(1),
            parent: null,
            blockedBy: [],
            body: '',
        },
    ],
]);
const workflows = [];
const assignments = [];
let assignmentSucceeds = false;
let next = 10;

const dispatchedIssues = () =>
    workflows.map(([, , field]) => Number(field.split('=').pop()));

function $(strings, ...values) {
    const command = strings.join('?');
    let result = {};
    if (command === 'gh issue view ? --json state,stateReason,labels,url') {
        result.stdout = JSON.stringify(issues.get(Number(values[0])));
    } else if (
        command === 'gh issue view ? --json subIssues' ||
        command === 'gh issue view ? --json blocking'
    ) {
        const number = Number(values[0]);
        const all = [...issues.values()];
        const nodes = all.filter(issue => issue.parent?.number === number);
        const blocking = all.filter(issue => issue.blockedBy.includes(number));
        result.stdout = JSON.stringify({
            subIssues: { nodes, totalCount: nodes.length },
            blocking: { nodes: blocking, totalCount: blocking.length },
        });
    } else if (command.startsWith('gh label create ')) {
        result = {};
    } else if (command.startsWith('gh issue create ')) {
        const [title, bodyPath, parentNumber, blockedBy, labels] = values;
        const number = next++;
        const dependencies = blockedBy.length
            ? blockedBy[1].split(',').map(Number)
            : [];
        const issue = {
            number,
            title,
            body: readFileSync(bodyPath, 'utf8'),
            state: 'OPEN',
            stateReason: null,
            labels: labels
                .filter((value, index) => index % 2)
                .map(name => ({ name })),
            url: issueUrl(number),
            parent: {
                number: Number(parentNumber),
                url: issueUrl(Number(parentNumber)),
            },
            blockedBy: dependencies,
        };
        issues.set(number, issue);
        result.stdout = issue.url;
    } else if (
        command === 'gh issue view ? --json blockedBy' ||
        command === 'gh issue view ? --json state,labels,blockedBy,url'
    ) {
        const value = String(values[0]);
        const number = Number(
            value.includes('/issues/') ? value.split('/').pop() : value,
        );
        const issue = issues.get(number);
        if (!issue) throw new Error(`Unknown issue ${number}`);
        const nodes = issue.blockedBy.map(id => issues.get(id));
        result.stdout = JSON.stringify({
            ...issue,
            blockedBy: { nodes, totalCount: nodes.length },
        });
    } else if (command === 'gh issue view ? --json state,stateReason') {
        const issue = issues.get(Number(String(values[0]).split('/').pop()));
        if (!issue) throw new Error(`Unknown prerequisite ${values[0]}`);
        result.stdout = JSON.stringify(issue);
    } else if (command === 'gh issue edit ? --add-assignee @copilot') {
        assignments.push(Number(String(values[0]).split('/').pop()));
        if (!assignmentSucceeds)
            throw new Error('Resource not accessible by integration');
    } else if (
        command === 'gh workflow run implement-issue.yml --repo ? --ref ? -f ?'
    ) {
        workflows.push(values);
    } else if (command === 'gh issue edit ? --add-blocked-by ?') {
        issues
            .get(Number(values[0]))
            .blockedBy.push(...String(values[1]).split(',').map(Number));
    } else {
        throw new Error(`Unexpected command ${command}`);
    }
    return Promise.resolve(result);
}

mock.module('zx', { exports: { ...zx, $, argv } });
try {
    process.chdir(temporary);
    mkdirSync(join('documents', 'test-1'), { recursive: true });
    const task = {
        title: 'Test',
        body: 'Test',
        labels: ['server'],
        issue: null,
    };
    const plan = {
        issue: 1,
        url: issueUrl(1),
        engine: 'copilot',
        scopes: ['server'],
        status: 'pending',
        tasks: [
            { ...task, dependsOn: [] },
            { ...task, dependsOn: null },
            { ...task, dependsOn: [0, 1] },
        ],
    };
    const path = join('documents', 'test-1', 'tasks.yml');
    writeFileSync(path, stringify(plan));
    await import(
        `${pathToFileURL(join(root, 'script', 'process-tasks.ts'))}?integration`
    );
    const saved = parse(readFileSync(path, 'utf8'));
    assert.deepEqual(
        [10, 11, 12].map(number => issues.get(number).parent.number),
        [1, 1, 1],
    );
    assert.deepEqual(issues.get(12).blockedBy, [10, 11]);
    assert.deepEqual(dispatchedIssues(), [10, 11]);
    assert.equal(saved.status, 'completed');
    assert.equal(saved.tasks[2].delegated, undefined);
    issues.get(12).blockedBy = [10];
    saved.status = 'pending';
    writeFileSync(path, stringify(saved));
    await import(
        `${pathToFileURL(join(root, 'script', 'process-tasks.ts'))}?recovery`
    );
    assert.deepEqual(issues.get(12).blockedBy, [10, 11]);
    assert.deepEqual(dispatchedIssues(), [10, 11]);
    issues.get(1).state = 'OPEN';
    issues.get(1).stateReason = null;
    issues.get(10).state = 'CLOSED';
    issues.get(10).stateReason = 'COMPLETED';
    issues.get(11).state = 'CLOSED';
    issues.get(11).stateReason = 'NOT_PLANNED';
    argv._ = ['10', 'closed', 'main'];
    await import(
        `${pathToFileURL(join(root, 'script', 'assign-issue.ts'))}?first`
    );
    assert.deepEqual(dispatchedIssues(), [10, 11]);
    issues.get(1).state = 'CLOSED';
    issues.get(1).stateReason = 'COMPLETED';
    argv._ = ['1', 'closed', 'main'];
    await import(
        `${pathToFileURL(join(root, 'script', 'assign-issue.ts'))}?parent-closed`
    );
    assert.deepEqual(dispatchedIssues(), [10, 11]);
    issues.get(1).state = 'OPEN';
    issues.get(1).stateReason = null;
    issues.get(11).stateReason = 'COMPLETED';
    argv._ = ['11', 'closed', 'main'];
    await import(
        `${pathToFileURL(join(root, 'script', 'assign-issue.ts'))}?second`
    );
    assert.deepEqual(dispatchedIssues(), [10, 11, 12]);
    issues.set(14, {
        number: 14,
        state: 'OPEN',
        stateReason: null,
        labels: [],
        url: issueUrl(14),
        parent: { number: 1, url: issueUrl(1) },
        blockedBy: [1],
    });
    argv._ = ['14', 'opened', 'main'];
    await import(
        `${pathToFileURL(join(root, 'script', 'assign-issue.ts'))}?explicit-parent-blocker`
    );
    assert.deepEqual(dispatchedIssues(), [10, 11, 12]);
    issues.get(1).state = 'CLOSED';
    issues.get(1).stateReason = 'NOT_PLANNED';
    argv._ = ['14', 'reopened', 'main'];
    await import(
        `${pathToFileURL(join(root, 'script', 'assign-issue.ts'))}?uncompleted-parent-blocker`
    );
    assert.deepEqual(dispatchedIssues(), [10, 11, 12]);
    issues.set(15, {
        number: 15,
        state: 'OPEN',
        stateReason: null,
        labels: [],
        url: issueUrl(15),
        parent: { number: 1, url: issueUrl(1) },
        blockedBy: [],
    });
    argv._ = ['15', 'opened', 'main'];
    await import(
        `${pathToFileURL(join(root, 'script', 'assign-issue.ts'))}?uncompleted-parent`
    );
    assert.deepEqual(dispatchedIssues(), [10, 11, 12, 15]);
    issues.get(1).stateReason = 'COMPLETED';
    argv._ = ['1', 'closed', 'main'];
    await import(
        `${pathToFileURL(join(root, 'script', 'assign-issue.ts'))}?completed-parent-blocker`
    );
    assert.deepEqual(dispatchedIssues(), [10, 11, 12, 15, 14]);
    issues.set(13, {
        number: 13,
        state: 'OPEN',
        stateReason: null,
        labels: [{ name: 'agent-gemini-cli' }],
        url: issueUrl(13),
        parent: null,
        blockedBy: [],
    });
    argv._ = ['13', 'opened', 'main'];
    await import(
        `${pathToFileURL(join(root, 'script', 'assign-issue.ts'))}?engine`
    );
    assert.deepEqual(dispatchedIssues(), [10, 11, 12, 15, 14, 13]);
    assert.deepEqual(assignments, [10, 11, 12, 15, 14]);

    issues.set(16, {
        number: 16,
        state: 'OPEN',
        stateReason: null,
        labels: [],
        url: issueUrl(16),
        parent: null,
        blockedBy: [],
    });
    assignmentSucceeds = true;
    argv._ = ['16', 'opened', 'main'];

    await import(
        `${pathToFileURL(join(root, 'script', 'assign-issue.ts'))}?assignment`
    );
    assert.deepEqual(assignments, [10, 11, 12, 15, 14, 16]);
    assert.deepEqual(dispatchedIssues(), [10, 11, 12, 15, 14, 13]);
} finally {
    process.chdir(root);
    rmSync(temporary, { recursive: true, force: true });
}
