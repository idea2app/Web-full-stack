export interface RequirementTask {
    title: string;
    body: string;
    labels: string[];
    dependsOn: number | null;
}

export interface StoredRequirementTask extends RequirementTask {
    issue: number | null;
    delegated?: boolean;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const isPositiveInteger = (value: unknown): value is number =>
    Number.isInteger(value) && (value as number) > 0;

export const isValidRequirementTask = (
    task: unknown,
    index: number,
    scopes: readonly string[],
): task is RequirementTask =>
    isObject(task) &&
    typeof task.title === 'string' &&
    !!task.title.trim() &&
    task.title.length <= 200 &&
    typeof task.body === 'string' &&
    !!task.body.trim() &&
    task.body.length <= 30_000 &&
    Array.isArray(task.labels) &&
    task.labels.length > 0 &&
    task.labels.every(
        (label: unknown) => typeof label === 'string' && scopes.includes(label),
    ) &&
    (task.dependsOn === null ||
        (Number.isInteger(task.dependsOn) &&
            (task.dependsOn as number) >= 0 &&
            (task.dependsOn as number) < index));

export const isValidStoredRequirementTask = (
    task: unknown,
    index: number,
    scopes: readonly string[],
): task is StoredRequirementTask =>
    isObject(task) &&
    isValidRequirementTask(task, index, scopes) &&
    (task.issue === null || isPositiveInteger(task.issue)) &&
    (task.delegated === undefined || typeof task.delegated === 'boolean') &&
    (task.delegated !== true || isPositiveInteger(task.issue));
