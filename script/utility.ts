import { $, fs, path, type ProcessPromise } from 'zx';
import { stringify } from 'yaml';

export const isPositiveInteger = (value: unknown): value is number =>
    Number.isInteger(value) && (value as number) > 0;

export const isObject = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

export function documentDirectory(title: string, issueNumber: string) {
    const slug = title
        .normalize('NFKC')
        .replace(/[^\p{L}\p{N} .()_-]+/gu, '-')
        .replace(/\.{2,}/g, '.')
        .trim()
        .replace(/^[ .-]+|[ .-]+$/g, '')
        .replace(/[ ._-]+/g, '-')
        .slice(0, 100);
    return path.join('documents', `${slug || 'issue'}-${issueNumber}`);
}

export const formatRequirementDocument = (
    metadata: Record<string, unknown>,
    body: string,
) => `---
${stringify(metadata)}---

${body.trim()}
`;

export async function removeRootHiddenDirectories(directory: string) {
    const entries = await fs.readdir(directory, { withFileTypes: true });

    for (const entry of entries)
        if (entry.isDirectory() && entry.name.startsWith('.'))
            await fs.rm(path.join(directory, entry.name), {
                recursive: true,
                force: true,
            });
}

export function isCompletedIssue(issue: {
    state: string;
    stateReason: string | null;
}): boolean {
    return issue.state === 'CLOSED' && issue.stateReason === 'COMPLETED';
}

export function parseRequirementScopes(value: unknown): string[] {
    const values: unknown[] = Array.isArray(value) ? value : [value];

    if (!values.every((item): item is string => typeof item === 'string'))
        throw new Error('Select one or more valid development scopes.');

    const scopes = values
        .flatMap(item => item.split(','))
        .map(scope => scope.trim());
    const allowedScopes = new Set(['server', 'browser', 'mobile']);

    if (!scopes.length || scopes.some(scope => !allowedScopes.has(scope)))
        throw new Error('Select one or more valid development scopes.');

    return scopes;
}

export interface RequirementTask {
    title: string;
    body: string;
    labels: string[];
    dependsOn: number | null;
}

export interface StoredRequirementTask extends RequirementTask {
    issue: number | null;
    url?: string | null;
    delegated?: boolean;
}

export interface RequirementPlan {
    issue: number;
    url?: string;
    title?: string;
    engine: AIEngine;
    scopes: string[];
    status: 'processing' | 'incomplete' | 'pending' | 'completed';
    tasks: StoredRequirementTask[];
}

export interface RequirementInput {
    issueNumber: string;
    issueUrl: string;
    issueTitle: string;
    issueBody: string;
}

export const isValidRequirementInput = ({
    issueNumber,
    issueUrl,
    issueTitle,
    issueBody,
}: RequirementInput) =>
    !!issueNumber &&
    URL.parse(issueUrl)?.protocol === 'https:' &&
    !!issueTitle &&
    !!issueBody;

export function isAllowedAttachment(rawUrl: string): boolean {
    const url = URL.parse(rawUrl);

    return (
        !!url &&
        url.protocol === 'https:' &&
        ((url.hostname === 'github.com' &&
            url.pathname.startsWith('/user-attachments/')) ||
            (url.hostname.endsWith('.githubusercontent.com') &&
                url.hostname !== 'raw.githubusercontent.com'))
    );
}

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
    (task.url === undefined ||
        task.url === null ||
        (typeof task.url === 'string' && URL.canParse(task.url))) &&
    (task.delegated === undefined || typeof task.delegated === 'boolean') &&
    (task.delegated !== true || isPositiveInteger(task.issue));

export type RequirementOutputRecord =
    | { type: 'task'; task: RequirementTask }
    | { type: 'complete'; taskCount: number };

export function parseRequirementOutputLine(
    line: string,
    index: number,
    scopes: readonly string[],
): RequirementOutputRecord {
    const record: unknown = JSON.parse(line);

    if (!isObject(record))
        throw new Error('Task output must be a JSON object.');
    if (
        record.type === 'complete' &&
        Number.isInteger(record.taskCount) &&
        (record.taskCount as number) >= 0
    )
        return { type: 'complete', taskCount: record.taskCount as number };

    const { type, ...task } = record;

    if (type !== 'task' || !isValidRequirementTask(task, index, scopes))
        throw new Error('The generated task record is invalid.');

    return { type, task };
}

export type AIEngine =
    | 'copilot'
    | 'openai-codex'
    | 'gemini-cli'
    | 'claude-code'
    | 'qoder-cli'
    | 'kimi-cli'
    | 'kilo-cli';

const credentials: Record<AIEngine, string[]> = {
    copilot: ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN'],
    'openai-codex': ['OPENAI_API_KEY'],
    'gemini-cli': ['GEMINI_API_KEY'],
    'claude-code': ['ANTHROPIC_API_KEY'],
    'qoder-cli': ['QODER_PERSONAL_ACCESS_TOKEN'],
    'kimi-cli': ['MOONSHOT_API_KEY'],
    'kilo-cli': ['KILO_CONFIG_CONTENT'],
};

async function* runWithCredentials(
    engine: AIEngine,
    action: () => ProcessPromise,
): AsyncGenerator<string> {
    const savedCredentials = new Map(
        Object.values(credentials)
            .flat()
            .map(name => [name, process.env[name]]),
    );
    for (const name of savedCredentials.keys()) delete process.env[name];
    for (const name of credentials[engine]) {
        const value = savedCredentials.get(name);
        if (value) process.env[name] = value;
    }

    try {
        yield* action();
    } finally {
        for (const [name, value] of savedCredentials)
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
    }
}

const promptWithFiles = (prompt: string, attachments: string[]) =>
    [
        prompt,
        ...attachments.map(path => `Read the attachment at ${path}.`),
    ].join('\n\n');

export const runCopilot = (prompt: string, attachments: string[] = []) =>
    runWithCredentials('copilot', () => {
        const args = attachments.flatMap(path => ['--attachment', path]);

        return $`pnpm dlx --package=@github/copilot@1.0.114 copilot --no-auto-update --no-custom-instructions --no-ask-user --disable-builtin-mcps --available-tools read --allow-tool read --silent -p ${promptWithFiles(
            prompt,
            attachments,
        )} ${args}`;
    });

export const runOpenAICodex = (
    prompt: string,
    attachments: string[] = [],
    allowChanges = false,
) =>
    runWithCredentials('openai-codex', () => {
        const sandbox = allowChanges ? 'workspace-write' : 'read-only';
        const approval = allowChanges ? ['--approve-for-me'] : [];

        return $`pnpm dlx --package=@openai/codex@0.171.0 codex exec --sandbox ${sandbox} ${approval} ${promptWithFiles(
            prompt,
            attachments,
        )}`;
    });

export const runGeminiCLI = (
    prompt: string,
    attachments: string[] = [],
    allowChanges = false,
) =>
    runWithCredentials('gemini-cli', () => {
        const permissions = allowChanges
            ? ['--yolo']
            : ['--approval-mode', 'plan'];

        return $`pnpm dlx --package=@google/gemini-cli@0.70.0 gemini --prompt ${promptWithFiles(
            prompt,
            attachments,
        )} --output-format text ${permissions}`;
    });

export const runClaudeCode = (
    prompt: string,
    attachments: string[] = [],
    allowChanges = false,
) =>
    runWithCredentials('claude-code', () => {
        const permissions = allowChanges
            ? [
                  '--permission-mode',
                  'bypassPermissions',
                  '--allow-dangerously-skip-permissions',
              ]
            : ['--tools', 'Read', '--permission-mode', 'plan'];

        return $`pnpm dlx --package=@anthropic-ai/claude-code@2.1.329 claude -p ${promptWithFiles(
            prompt,
            attachments,
        )} --output-format text ${permissions}`;
    });

export const runQoderCLI = (
    prompt: string,
    attachments: string[] = [],
    allowChanges = false,
) =>
    runWithCredentials('qoder-cli', () => {
        const permissions = allowChanges ? ['--yolo'] : [];
        return $`pnpm dlx --package=@qoder-ai/qodercli@1.1.95 qoder -p ${promptWithFiles(
            prompt,
            attachments,
        )} --output-format text ${permissions}`;
    });

export const runKimiCLI = (prompt: string, attachments: string[] = []) =>
    runWithCredentials(
        'kimi-cli',
        () =>
            $`kimi --print -p ${promptWithFiles(
                prompt,
                attachments,
            )} --final-message-only`,
    );

export const runKiloCLI = (
    prompt: string,
    attachments: string[] = [],
    allowChanges = false,
) =>
    runWithCredentials('kilo-cli', () => {
        const files = attachments.flatMap(path => ['--file', path]);
        const permissions = allowChanges ? ['--auto'] : [];

        return $`pnpm dlx --package=@kilocode/cli@7.8.32 kilo run ${promptWithFiles(
            prompt,
            attachments,
        )} ${permissions} ${files}`;
    });

export function runAI(
    engine: AIEngine,
    prompt: string,
    attachments: string[] = [],
    allowChanges = false,
): AsyncGenerator<string> {
    switch (engine) {
        case 'copilot':
            return runCopilot(prompt, attachments);
        case 'openai-codex':
            return runOpenAICodex(prompt, attachments, allowChanges);
        case 'gemini-cli':
            return runGeminiCLI(prompt, attachments, allowChanges);
        case 'claude-code':
            return runClaudeCode(prompt, attachments, allowChanges);
        case 'qoder-cli':
            return runQoderCLI(prompt, attachments, allowChanges);
        case 'kimi-cli':
            return runKimiCLI(prompt, attachments);
        case 'kilo-cli':
            return runKiloCLI(prompt, attachments, allowChanges);
    }
}
