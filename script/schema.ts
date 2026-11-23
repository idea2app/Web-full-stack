import { z } from 'zod';

const positiveIntegerSchema = z.number().int().positive();
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const parseableUrlSchema = z.string().refine(value => URL.canParse(value));

export const AIEngineSchema = z.enum([
    'copilot',
    'openai-codex',
    'gemini-cli',
    'claude-code',
    'qoder-cli',
    'kimi-cli',
    'kilo-cli',
]);

export type AIEngine = z.infer<typeof AIEngineSchema>;

export const isAIEngine = (value: unknown): value is AIEngine =>
    AIEngineSchema.safeParse(value).success;

const developmentScopeSchema = z.enum(['server', 'browser', 'mobile', 'skill']);

export type DevelopmentScope = z.infer<typeof developmentScopeSchema>;

const requirementScopesSchema = z
    .union([z.string(), z.array(z.string())])
    .transform(values => {
        const items = Array.isArray(values) ? values : [values];

        return items
            .flatMap(item => item.split(','))
            .map(scope => scope.trim());
    })
    .pipe(z.array(developmentScopeSchema).min(1));

export function parseRequirementScopes(value: unknown): DevelopmentScope[] {
    const result = requirementScopesSchema.safeParse(value);

    if (!result.success)
        throw new Error('Select one or more valid development scopes.');

    return result.data;
}

export const RequirementInputSchema = z
    .object({
        issueNumber: z.string().min(1),
        issueUrl: z
            .string()
            .refine(value => URL.parse(value)?.protocol === 'https:'),
        issueTitle: z.string().min(1),
        issueBody: z.string().min(1),
    })
    .strict();

export type RequirementInput = z.infer<typeof RequirementInputSchema>;

export const isValidRequirementInput = (
    value: unknown,
): value is RequirementInput => RequirementInputSchema.safeParse(value).success;

export const IssueReferenceSchema = z
    .object({
        number: positiveIntegerSchema,
        state: z.string(),
        url: parseableUrlSchema,
    })
    .passthrough();

export type IssueReference = z.infer<typeof IssueReferenceSchema>;

const issueReferenceConnectionSchema = z
    .object({
        nodes: z.array(IssueReferenceSchema),
        totalCount: nonNegativeIntegerSchema,
    })
    .passthrough()
    .refine(connection => connection.totalCount === connection.nodes.length);

const issueReferencesResponseSchema = z
    .object({
        subIssues: issueReferenceConnectionSchema.optional(),
        blockedBy: issueReferenceConnectionSchema.optional(),
        blocking: issueReferenceConnectionSchema.optional(),
    })
    .passthrough();

export function parseIssueReferences(
    output: string,
    field: 'subIssues' | 'blockedBy' | 'blocking',
): IssueReference[] {
    const result = issueReferencesResponseSchema.safeParse(JSON.parse(output));
    const connection = result.success ? result.data[field] : undefined;

    if (!connection)
        throw new Error(`Invalid or incomplete ${field} response from gh.`);

    return connection.nodes;
}

const dependencyListSchema = z
    .array(nonNegativeIntegerSchema)
    .superRefine((dependencies, context) => {
        if (new Set(dependencies).size !== dependencies.length)
            context.addIssue({
                code: 'custom',
                message: 'Task dependencies must be unique.',
            });
    });

export const RequirementTaskSchema = z
    .object({
        title: z
            .string()
            .refine(value => !!value.trim())
            .max(200),
        body: z
            .string()
            .refine(value => !!value.trim())
            .max(30_000),
        labels: z.array(z.string()).min(1),
        dependsOn: dependencyListSchema,
    })
    .strict();

export type RequirementTask = z.infer<typeof RequirementTaskSchema>;

function isTaskValidForPlan(
    task: Pick<RequirementTask, 'labels' | 'dependsOn'>,
    index: number,
    scopes: readonly string[],
): boolean {
    return (
        task.labels.every(label => scopes.includes(label)) &&
        task.dependsOn.every(dependency => dependency < index)
    );
}

export function isValidRequirementTask(
    value: unknown,
    index: number,
    scopes: readonly string[],
): value is RequirementTask {
    const result = RequirementTaskSchema.safeParse(value);

    return result.success && isTaskValidForPlan(result.data, index, scopes);
}

export const StoredRequirementTaskSchema = z
    .object({
        ...RequirementTaskSchema.shape,
        dependsOn: z.union([
            dependencyListSchema,
            nonNegativeIntegerSchema,
            z.null(),
        ]),
        issue: positiveIntegerSchema.nullable(),
        url: parseableUrlSchema.nullable().optional(),
        delegated: z.boolean().optional(),
    })
    .strict()
    .superRefine((task, context) => {
        if (task.delegated && task.issue === null)
            context.addIssue({
                code: 'custom',
                path: ['issue'],
                message: 'A delegated task must have an issue number.',
            });
    });

export type StoredRequirementTask = z.infer<typeof StoredRequirementTaskSchema>;

function storedTaskDependencies(
    value: StoredRequirementTask['dependsOn'],
): number[] {
    return Array.isArray(value) ? value : value === null ? [] : [value];
}

export function isValidStoredRequirementTask(
    value: unknown,
    index: number,
    scopes: readonly string[],
): value is StoredRequirementTask {
    const result = StoredRequirementTaskSchema.safeParse(value);

    return (
        result.success &&
        isTaskValidForPlan(
            {
                labels: result.data.labels,
                dependsOn: storedTaskDependencies(result.data.dependsOn),
            },
            index,
            scopes,
        )
    );
}

export const RequirementPlanSchema = z
    .object({
        issue: positiveIntegerSchema,
        url: parseableUrlSchema.optional(),
        title: z.string().optional(),
        engine: AIEngineSchema,
        scopes: z.array(developmentScopeSchema).min(1),
        status: z.enum(['processing', 'incomplete', 'pending', 'completed']),
        tasks: z.array(StoredRequirementTaskSchema).min(1),
    })
    .strict()
    .superRefine((plan, context) => {
        plan.tasks.forEach((task, index) => {
            const dependencies = storedTaskDependencies(task.dependsOn);

            if (
                !isTaskValidForPlan(
                    { labels: task.labels, dependsOn: dependencies },
                    index,
                    plan.scopes,
                )
            )
                context.addIssue({
                    code: 'custom',
                    path: ['tasks', index],
                    message:
                        'Task labels must be selected scopes and dependencies must reference earlier tasks.',
                });
        });
    });

export type RequirementPlan = z.infer<typeof RequirementPlanSchema>;

const RequirementOutputLineSchema = z.discriminatedUnion('type', [
    z
        .object({
            type: z.literal('task'),
            ...RequirementTaskSchema.shape,
        })
        .strict(),
    z
        .object({
            type: z.literal('complete'),
            taskCount: nonNegativeIntegerSchema,
        })
        .strict(),
]);

const RequirementOutputRecordSchema = z.discriminatedUnion('type', [
    z
        .object({
            type: z.literal('task'),
            task: RequirementTaskSchema,
        })
        .strict(),
    z
        .object({
            type: z.literal('complete'),
            taskCount: nonNegativeIntegerSchema,
        })
        .strict(),
]);

export type RequirementOutputRecord = z.infer<
    typeof RequirementOutputRecordSchema
>;

export function parseRequirementOutputLine(
    line: string,
    index: number,
    scopes: readonly string[],
): RequirementOutputRecord {
    const result = RequirementOutputLineSchema.safeParse(JSON.parse(line));

    if (!result.success)
        throw new Error('The generated task record is invalid.');

    if (result.data.type === 'complete') return result.data;

    const { type, ...task } = result.data;

    if (!isTaskValidForPlan(task, index, scopes))
        throw new Error('The generated task record is invalid.');

    return RequirementOutputRecordSchema.parse({ type, task });
}
