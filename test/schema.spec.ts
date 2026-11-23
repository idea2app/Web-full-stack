import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { RequirementPlanSchema } from '../script/schema.ts';

describe('requirement plan schema', () => {
    const plan = {
        issue: 42,
        url: 'https://github.com/idea2app/Web-full-stack/issues/42',
        title: 'Example feature',
        engine: 'copilot',
        scopes: ['server', 'browser'],
        status: 'pending',
        tasks: [
            {
                title: 'Create a record',
                body: 'Create and persist the record.',
                labels: ['server'],
                dependsOn: [],
                issue: null,
                url: null,
            },
            {
                title: 'Show the record',
                body: 'Display the persisted record.',
                labels: ['browser'],
                dependsOn: [0],
                issue: null,
                url: null,
            },
        ],
    };

    it('accepts a valid plan with ordered dependencies and selected scopes', () => {
        assert.equal(RequirementPlanSchema.safeParse(plan).success, true);
    });

    it('rejects invalid dependencies, unselected scopes, and extra fields', () => {
        assert.equal(
            RequirementPlanSchema.safeParse({
                ...plan,
                tasks: [{ ...plan.tasks[0], dependsOn: [1] }, plan.tasks[1]],
            }).success,
            false,
        );
        assert.equal(
            RequirementPlanSchema.safeParse({
                ...plan,
                tasks: [{ ...plan.tasks[0], labels: ['mobile'] }],
            }).success,
            false,
        );
        assert.equal(
            RequirementPlanSchema.safeParse({ ...plan, unexpected: true })
                .success,
            false,
        );
    });
});
