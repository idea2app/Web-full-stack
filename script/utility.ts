import { $, fs, path, type ProcessPromise } from 'zx';
import { stringify } from 'yaml';

import {
    isAIEngine,
    parseIssueReferences,
    parseRequirementScopes,
    type AIEngine,
    type StoredRequirementTask,
} from './schema.ts';

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

export function formatRequirementDocument(
    fields: Record<string, unknown> & { title: string },
    attachmentText = '',
) {
    const { requirement, ...metadata } = fields;

    if (typeof requirement !== 'string' || !requirement.trim())
        throw new Error('The requirement details must not be empty.');

    metadata.scopes = parseRequirementScopes(fields.scopes);

    const body = requirement
        .trim()
        .replace(
            /^```(?:markdown|md)[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/i,
            '$1',
        );
    const content = [
        body,
        ...(attachmentText.trim()
            ? [`## Attachment text\n\n${attachmentText.trim()}`]
            : []),
    ].join('\n\n');

    return `---
${stringify(metadata)}---

# ${fields.title}

${content}
`;
}

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

export async function routeIssueIfReady(
    issueNumber: number | string,
    defaultBranch: string,
): Promise<boolean> {
    const { stdout } =
        await $`gh issue view ${issueNumber} --json state,labels,blockedBy,url`;
    const issue = JSON.parse(stdout);

    if (
        issue.state !== 'OPEN' ||
        issue.labels.some(
            ({ name }: { name: string }) => name === 'documentation',
        )
    )
        return false;

    for (const { url: prerequisite } of parseIssueReferences(
        stdout,
        'blockedBy',
    )) {
        const { stdout: result } =
            await $`gh issue view ${prerequisite} --json state,stateReason`;

        if (!isCompletedIssue(JSON.parse(result))) {
            console.log(
                `Issue ${issue.url} is waiting for completed prerequisite ${prerequisite}.`,
            );
            return false;
        }
    }
    if (!findIssueAgent(issue.labels.map(({ name }: { name: string }) => name)))
        try {
            await $`gh issue edit ${issue.url} --add-assignee @copilot`;
            return true;
        } catch (error) {
            console.warn(
                `Could not assign ${issue.url} to @copilot; falling back to the selected AI CLI.`,
                error,
            );
        }
    const url = new URL(issue.url);
    const repository = `${url.host}/${url.pathname.split('/').slice(1, 3).join('/')}`;
    const number = url.pathname.split('/').pop();

    await $`gh workflow run implement-issue.yml --repo ${repository} --ref ${defaultBranch} -f ${`issue_number=${number}`}`;
    return true;
}

export const taskDependencies = (task: StoredRequirementTask): number[] =>
    Array.isArray(task.dependsOn)
        ? task.dependsOn
        : task.dependsOn === null
          ? []
          : [task.dependsOn];

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

const credentials: Record<AIEngine, string[]> = {
    copilot: ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN'],
    'openai-codex': ['OPENAI_API_KEY'],
    'gemini-cli': ['GEMINI_API_KEY'],
    'claude-code': ['ANTHROPIC_API_KEY'],
    'qoder-cli': ['QODER_PERSONAL_ACCESS_TOKEN'],
    'kimi-cli': ['MOONSHOT_API_KEY'],
    'kilo-cli': ['KILO_CONFIG_CONTENT'],
};

export const findIssueAgent = (
    labels: readonly string[],
): Exclude<AIEngine, 'copilot'> | undefined =>
    labels
        .filter(label => label.startsWith('agent-'))
        .map(label => label.slice('agent-'.length))
        .find(
            (engine): engine is Exclude<AIEngine, 'copilot'> =>
                engine !== 'copilot' && isAIEngine(engine),
        );

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

export const runCopilot = (
    prompt: string,
    attachments: string[] = [],
    allowChanges = false,
) =>
    runWithCredentials('copilot', () => {
        const args = attachments.flatMap(path => ['--attachment', path]);
        const permissions = allowChanges
            ? [
                  '--available-tools',
                  'bash,edit,view,grep,glob',
                  '--allow-tool',
                  'read,write,shell',
                  '--secret-env-vars',
                  'GH_TOKEN,COPILOT_GITHUB_TOKEN',
                  '--deny-tool',
                  'shell(git commit)',
                  '--deny-tool',
                  'shell(git push)',
                  '--deny-tool',
                  'shell(gh)',
              ]
            : ['--available-tools', 'view,grep,glob', '--allow-tool', 'read'];

        return $`pnpm dlx --package=@github/copilot@1.0.114 copilot --no-auto-update --no-custom-instructions --no-ask-user --disable-builtin-mcps ${permissions} --silent -p ${promptWithFiles(
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
            return runCopilot(prompt, attachments, allowChanges);
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
