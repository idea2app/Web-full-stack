import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { parse } from 'yaml';

import {
    documentDirectory,
    formatRequirementDocument,
    isCompletedIssue,
    isValidRequirementTask,
    isValidStoredRequirementTask,
    parseRequirementScopes,
    removeRootHiddenDirectories,
} from '../../script/utility.ts';

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

    it('stores issue metadata in YAML front matter and preserves the body', () => {
        const document = formatRequirementDocument(
            {
                issue: 42,
                title: 'Example feature',
                engine: 'Copilot',
                scopes: ['server'],
            },
            '# Requirement\n\nBuild the feature.',
        );
        const [, frontMatter, body] =
            document.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/) ?? [];

        assert.deepEqual(parse(frontMatter), {
            issue: 42,
            title: 'Example feature',
            engine: 'Copilot',
            scopes: ['server'],
        });
        assert.equal(body, '# Requirement\n\nBuild the feature.\n');
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
        assert.deepEqual(parseRequirementScopes('server, browser, mobile'), [
            'server',
            'browser',
            'mobile',
        ]);
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

describe('requirement tasks', () => {
    const task = {
        title: 'Implement feature',
        body: 'Describe the feature',
        labels: ['server'],
        dependsOn: null,
    };

    it('validates scopes and dependencies', () => {
        assert.equal(isValidRequirementTask(task, 0, ['server']), true);
        assert.equal(isValidRequirementTask(task, 0, ['browser']), false);
        assert.equal(
            isValidRequirementTask({ ...task, dependsOn: 0 }, 0, ['server']),
            false,
        );
    });

    it('requires an issue number before delegation', () => {
        assert.equal(
            isValidStoredRequirementTask(
                { ...task, issue: 42, delegated: true },
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
    });
});
