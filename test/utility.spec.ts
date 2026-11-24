import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { parse } from 'yaml';

import {
    documentDirectory,
    findIssueAgent,
    formatRequirementDocument,
    isAllowedAttachment,
    isCompletedIssue,
    removeRootHiddenDirectories,
    taskDependencies,
} from '../script/utility.ts';
import {
    isValidRequirementInput,
    isValidRequirementTask,
    isValidStoredRequirementTask,
    parseIssueReferences,
    parseRequirementOutputLine,
    parseRequirementScopes,
} from '../script/schema.ts';

describe('issue documents', () => {
    it('creates a safe directory for the issue title', () => {
        assert.equal(
            documentDirectory('Example / feature', '42'),
            join('documents', 'Example-feature-42'),
        );
        assert.equal(
            documentDirectory('../../', '42'),
            join('documents', 'issue-42'),
        );
    });

    it('uses form metadata and renders the requirement as Markdown', () => {
        const document = formatRequirementDocument(
            {
                issue: 'https://github.com/idea2app/Web-full-stack/issues/42',
                title: 'Example feature',
                engine: 'Copilot',
                scopes: 'server, browser',
                requirement:
                    '```markdown\n# Overview\n\nBuild the feature.\n\n```ts\n# code\n```\n```',
            },
            '# Attachment heading\n\nAttachment content.',
        );
        const [, frontMatter, body] =
            document.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/) ?? [];

        assert.deepEqual(parse(frontMatter), {
            issue: 'https://github.com/idea2app/Web-full-stack/issues/42',
            title: 'Example feature',
            engine: 'Copilot',
            scopes: ['server', 'browser'],
        });
        assert.equal(
            body,
            '# Example feature\n\n# Overview\n\nBuild the feature.\n\n```ts\n# code\n```\n\n## Attachment text\n\n# Attachment heading\n\nAttachment content.\n',
        );
    });

    it('preserves unwrapped Markdown and rejects missing requirement details', () => {
        const document = formatRequirementDocument({
            title: 'Example',
            scopes: ['server'],
            requirement: 'Overview\n========\n\n### Details',
        });

        assert.match(
            document,
            /# Example\n\nOverview\n========\n\n### Details\n$/,
        );
        assert.throws(
            () => formatRequirementDocument({ title: 'Example' }),
            /requirement details must not be empty/,
        );
    });
});

describe('scaffold directories', () => {
    it('removes root hidden directories without removing visible directories', async () => {
        const root = await mkdtemp(join(tmpdir(), 'scaffold-'));

        try {
            await mkdir(join(root, '.github', 'workflows'), {
                recursive: true,
            });
            await mkdir(join(root, '.vscode'));
            await mkdir(join(root, 'src'));

            await removeRootHiddenDirectories(root);

            assert.deepEqual(await readdir(root), ['src']);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});

describe('requirement scopes', () => {
    it('parses comma-separated selections and arrays', () => {
        assert.deepEqual(
            parseRequirementScopes('server, browser, mobile, skill'),
            ['server', 'browser', 'mobile', 'skill'],
        );
        assert.deepEqual(parseRequirementScopes(['browser', 'mobile']), [
            'browser',
            'mobile',
        ]);
        assert.deepEqual(parseRequirementScopes('server'), ['server']);
    });

    it('rejects empty or invalid selections', () => {
        for (const value of ['', [], undefined, 'server, unknown', [42]])
            assert.throws(
                () => parseRequirementScopes(value),
                /Select one or more valid development scopes/,
            );
    });
});

describe('requirement input validation', () => {
    it('accepts HTTPS issue details and supported attachment URLs', () => {
        assert.equal(
            isValidRequirementInput({
                issueNumber: '42',
                issueUrl:
                    'https://github.com/idea2app/Web-full-stack/issues/42',
                issueTitle: 'Example feature',
                issueBody: 'Describe the feature',
            }),
            true,
        );
        assert.equal(
            isAllowedAttachment(
                'https://github.com/user-attachments/files/42/example.png',
            ),
            true,
        );
        assert.equal(
            isAllowedAttachment('https://files.githubusercontent.com/file.png'),
            true,
        );
    });

    it('rejects invalid issue details and unsupported attachment URLs', () => {
        assert.equal(
            isValidRequirementInput({
                issueNumber: '42',
                issueUrl: 'http://github.com/idea2app/Web-full-stack/issues/42',
                issueTitle: 'Example feature',
                issueBody: 'Describe the feature',
            }),
            false,
        );
        assert.equal(
            isAllowedAttachment('http://github.com/user-attachments/42'),
            false,
        );
        assert.equal(
            isAllowedAttachment('https://github.com/issues/42'),
            false,
        );
        assert.equal(
            isAllowedAttachment(
                'https://raw.githubusercontent.com/user/repo/file',
            ),
            false,
        );
    });
});

describe('completed issues', () => {
    it('accepts only issues closed as completed', () => {
        assert.equal(
            isCompletedIssue({ state: 'CLOSED', stateReason: 'COMPLETED' }),
            true,
        );
        for (const stateReason of ['NOT_PLANNED', 'DUPLICATE', null])
            assert.equal(
                isCompletedIssue({ state: 'CLOSED', stateReason }),
                false,
            );
        assert.equal(
            isCompletedIssue({ state: 'OPEN', stateReason: 'COMPLETED' }),
            false,
        );
    });
});

describe('issue relationships', () => {
    it('parses the gh connection for empty and populated results', () => {
        assert.deepEqual(
            parseIssueReferences(
                '{"subIssues":{"nodes":[],"totalCount":0}}',
                'subIssues',
            ),
            [],
        );
        const nodes = [
            {
                number: 42,
                state: 'OPEN',
                url: 'https://github.com/a/b/issues/42',
            },
            {
                number: 43,
                state: 'CLOSED',
                url: 'https://github.com/a/b/issues/43',
            },
        ];
        assert.deepEqual(
            parseIssueReferences(
                JSON.stringify({ subIssues: { nodes, totalCount: 2 } }),
                'subIssues',
            ),
            nodes,
        );
    });

    describe('issue dependencies', () => {
        it('links prerequisites and routes only after every prerequisite is completed', () => {
            const result = spawnSync(
                process.execPath,
                [
                    '--experimental-test-module-mocks',
                    '--import',
                    '@swc-node/register/esm-register',
                    join('test', 'issue-workflow-fixture.mjs'),
                ],
                { encoding: 'utf8' },
            );
            assert.equal(result.status, 0, result.stderr || result.stdout);
        });

        it('parses dependency connections and rejects incomplete results', () => {
            const nodes = [
                {
                    number: 42,
                    state: 'CLOSED',
                    url: 'https://github.com/a/b/issues/42',
                },
                {
                    number: 43,
                    state: 'OPEN',
                    url: 'https://github.com/a/b/issues/43',
                },
            ];
            assert.deepEqual(
                parseIssueReferences(
                    JSON.stringify({ blockedBy: { nodes, totalCount: 2 } }),
                    'blockedBy',
                ),
                nodes,
            );
            assert.throws(
                () =>
                    parseIssueReferences(
                        JSON.stringify({ blockedBy: { nodes, totalCount: 3 } }),
                        'blockedBy',
                    ),
                /Invalid or incomplete blockedBy/,
            );
        });
    });

    it('rejects malformed or incomplete responses', () => {
        for (const subIssues of [
            [],
            { nodes: [{ number: 42 }], totalCount: 1 },
            { nodes: [], totalCount: 1 },
        ])
            assert.throws(
                () =>
                    parseIssueReferences(
                        JSON.stringify({ subIssues }),
                        'subIssues',
                    ),
                /Invalid or incomplete subIssues/,
            );
    });
});

describe('issue agent labels', () => {
    it('selects the first supported non-Copilot agent from prefixed labels', () => {
        assert.equal(
            findIssueAgent([
                'server',
                'agent-unknown',
                'agent-copilot',
                'agent-kimi-cli',
                'agent-gemini-cli',
            ]),
            'kimi-cli',
        );
        assert.equal(
            findIssueAgent(['kimi-cli', 'agent-constructor', 'agent-copilot']),
            undefined,
        );
    });
});

describe('AI CLI execution', () => {
    it('enables automatic execution and preserves credential isolation', () => {
        const result = spawnSync(
            process.execPath,
            [
                '--experimental-test-module-mocks',
                '--import',
                '@swc-node/register/esm-register',
                join('test', 'ai-cli-fixture.mjs'),
            ],
            { encoding: 'utf8' },
        );
        assert.equal(result.status, 0, result.stderr || result.stdout);
    });
});

describe('requirement tasks', () => {
    const task = {
        title: 'Implement feature',
        body: 'Describe the feature',
        labels: ['server'],
        dependsOn: [],
    };

    it('validates scopes and dependencies', () => {
        assert.equal(isValidRequirementTask(task, 0, ['server']), true);
        assert.equal(
            isValidRequirementTask({ ...task, labels: ['skill'] }, 0, [
                'server',
                'skill',
            ]),
            true,
        );
        assert.equal(isValidRequirementTask(task, 0, ['browser']), false);
        assert.equal(
            isValidRequirementTask({ ...task, dependsOn: 0 }, 0, ['server']),
            false,
        );
        assert.equal(
            isValidRequirementTask({ ...task, dependsOn: [0, 1] }, 2, [
                'server',
            ]),
            true,
        );
        for (const dependsOn of [[0, 0], [2], [-1], [1.5]])
            assert.equal(
                isValidRequirementTask({ ...task, dependsOn }, 2, ['server']),
                false,
            );
        assert.deepEqual(
            taskDependencies({ ...task, issue: null, dependsOn: 0 }),
            [0],
        );
        assert.deepEqual(
            taskDependencies({ ...task, issue: null, dependsOn: null }),
            [],
        );
    });

    it('parses JSONL task and completion records', () => {
        assert.deepEqual(
            parseRequirementOutputLine(
                JSON.stringify({ type: 'task', ...task }),
                0,
                ['server'],
            ),
            { type: 'task', task },
        );
        assert.deepEqual(
            parseRequirementOutputLine(
                JSON.stringify({ type: 'complete', taskCount: 1 }),
                1,
                ['server'],
            ),
            { type: 'complete', taskCount: 1 },
        );
        assert.throws(
            () =>
                parseRequirementOutputLine(
                    JSON.stringify({ type: 'complete', taskCount: -1 }),
                    1,
                    ['server'],
                ),
            /generated task record is invalid/,
        );
    });

    it('accepts streamed skill tasks only when skill is selected', () => {
        const record = JSON.stringify({
            type: 'task',
            ...task,
            labels: ['server', 'skill'],
        });

        assert.deepEqual(
            parseRequirementOutputLine(record, 0, ['server', 'skill']),
            {
                type: 'task',
                task: { ...task, labels: ['server', 'skill'] },
            },
        );
        assert.throws(
            () => parseRequirementOutputLine(record, 0, ['server']),
            /generated task record is invalid/,
        );
    });

    it('requires an issue number before delegation', () => {
        assert.equal(
            isValidStoredRequirementTask(
                { ...task, dependsOn: 0, issue: null },
                1,
                ['server'],
            ),
            true,
        );
        assert.equal(
            isValidStoredRequirementTask(
                { ...task, dependsOn: null, issue: null },
                0,
                ['server'],
            ),
            true,
        );
        assert.equal(
            isValidStoredRequirementTask(
                {
                    ...task,
                    issue: 42,
                    url: 'https://github.com/idea2app/Web-full-stack/issues/42',
                    delegated: true,
                },
                0,
                ['server'],
            ),
            true,
        );
        assert.equal(
            isValidStoredRequirementTask(
                { ...task, issue: null, delegated: true },
                0,
                ['server'],
            ),
            false,
        );
        assert.equal(
            isValidStoredRequirementTask(
                { ...task, issue: 42, url: 'not a URL' },
                0,
                ['server'],
            ),
            false,
        );
    });
});
