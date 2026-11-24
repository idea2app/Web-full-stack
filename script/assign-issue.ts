#! /usr/bin/env node

import { $, argv } from 'zx';

import { routeIssueIfReady } from './utility.ts';
import { parseIssueReferences } from './schema.ts';

$.verbose = true;

const issueNumber = String(argv._[0] ?? '');
const action = String(argv._[1] ?? '');
const defaultBranch = String(argv._[2] ?? '');

if (
    !issueNumber ||
    !['opened', 'reopened', 'closed'].includes(action) ||
    !defaultBranch
)
    throw new Error('Issue number, action, and default branch are required.');

if (action !== 'closed') await routeIssueIfReady(issueNumber, defaultBranch);
else {
    const { stdout } = await $`gh issue view ${issueNumber} --json blocking`;
    const candidates = parseIssueReferences(stdout, 'blocking');

    for (const url of new Set(
        candidates
            .filter(({ state }) => state === 'OPEN')
            .map(({ url }) => url),
    ))
        await routeIssueIfReady(url, defaultBranch);
}
