import { $, fs, path } from 'zx';
import { stringify } from 'yaml';

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
    delegated?: boolean;
}

export const isObject = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

export const isPositiveInteger = (value: unknown): value is number =>
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

async function runWithCredentials(
    engine: AIEngine,
    action: () => Promise<string>,
) {
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
        return await action();
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
    runWithCredentials('copilot', async () => {
        const args = attachments.flatMap(path => ['--attachment', path]);
        const { stdout } =
            await $`pnpm dlx --package=@github/copilot@1.0.114 copilot --no-auto-update --no-custom-instructions --no-ask-user --disable-builtin-mcps --available-tools read --allow-tool read --silent -p ${promptWithFiles(
                prompt,
                attachments,
            )} ${args}`;

        return stdout.trim();
    });

export const runOpenAICodex = (
    prompt: string,
    attachments: string[] = [],
    allowChanges = false,
) =>
    runWithCredentials('openai-codex', async () => {
        const sandbox = allowChanges ? 'workspace-write' : 'read-only';
        const approval = allowChanges ? ['--approve-for-me'] : [];
        const { stdout } =
            await $`pnpm dlx --package=@openai/codex@0.171.0 codex exec --sandbox ${sandbox} ${approval} ${promptWithFiles(
                prompt,
                attachments,
            )}`;
        return stdout.trim();
    });

export const runGeminiCLI = (
    prompt: string,
    attachments: string[] = [],
    allowChanges = false,
) =>
    runWithCredentials('gemini-cli', async () => {
        const permissions = allowChanges
            ? ['--yolo']
            : ['--approval-mode', 'plan'];
        const { stdout } =
            await $`pnpm dlx --package=@google/gemini-cli@0.70.0 gemini --prompt ${promptWithFiles(
                prompt,
                attachments,
            )} --output-format text ${permissions}`;

        return stdout.trim();
    });

export const runClaudeCode = (
    prompt: string,
    attachments: string[] = [],
    allowChanges = false,
) =>
    runWithCredentials('claude-code', async () => {
        const permissions = allowChanges
            ? [
                  '--permission-mode',
                  'bypassPermissions',
                  '--allow-dangerously-skip-permissions',
              ]
            : ['--tools', 'Read', '--permission-mode', 'plan'];
        const { stdout } =
            await $`pnpm dlx --package=@anthropic-ai/claude-code@2.1.329 claude -p ${promptWithFiles(
                prompt,
                attachments,
            )} --output-format text ${permissions}`;

        return stdout.trim();
    });

export const runQoderCLI = (
    prompt: string,
    attachments: string[] = [],
    allowChanges = false,
) =>
    runWithCredentials('qoder-cli', async () => {
        const permissions = allowChanges ? ['--yolo'] : [];
        const { stdout } =
            await $`pnpm dlx --package=@qoder-ai/qodercli@1.1.95 qoder -p ${promptWithFiles(
                prompt,
                attachments,
            )} --output-format text ${permissions}`;

        return stdout.trim();
    });

export const runKimiCLI = (prompt: string, attachments: string[] = []) =>
    runWithCredentials('kimi-cli', async () => {
        const { stdout } = await $`kimi --print -p ${promptWithFiles(
            prompt,
            attachments,
        )} --final-message-only`;

        return stdout.trim();
    });

export const runKiloCLI = (
    prompt: string,
    attachments: string[] = [],
    allowChanges = false,
) =>
    runWithCredentials('kilo-cli', async () => {
        const files = attachments.flatMap(path => ['--file', path]);
        const permissions = allowChanges ? ['--auto'] : [];
        const { stdout } =
            await $`pnpm dlx --package=@kilocode/cli@7.8.32 kilo run ${promptWithFiles(
                prompt,
                attachments,
            )} ${permissions} ${files}`;

        return stdout.trim();
    });

export async function runAI(
    engine: AIEngine,
    prompt: string,
    attachments: string[] = [],
    allowChanges = false,
) {
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
