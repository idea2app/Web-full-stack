#! /usr/bin/env node

import { $ } from 'zx';

export type AIEngine =
    'copilot' | 'claude-code' | 'gemini-cli' | 'openai-codex' | 'kimi-cli';

const credentials: Record<AIEngine, string[]> = {
    copilot: ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN'],
    'claude-code': ['ANTHROPIC_API_KEY'],
    'gemini-cli': ['GEMINI_API_KEY'],
    'openai-codex': ['OPENAI_API_KEY'],
    'kimi-cli': ['MOONSHOT_API_KEY'],
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

export const runKimiCLI = (prompt: string, attachments: string[] = []) =>
    runWithCredentials('kimi-cli', async () => {
        const { stdout } = await $`kimi --print -p ${promptWithFiles(
            prompt,
            attachments,
        )} --final-message-only`;

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
        case 'claude-code':
            return runClaudeCode(prompt, attachments, allowChanges);
        case 'gemini-cli':
            return runGeminiCLI(prompt, attachments, allowChanges);
        case 'openai-codex':
            return runOpenAICodex(prompt, attachments, allowChanges);
        case 'kimi-cli':
            return runKimiCLI(prompt, attachments);
    }
}
