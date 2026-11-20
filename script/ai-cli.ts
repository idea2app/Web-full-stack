#! /usr/bin/env node

import { $ } from 'zx';

export type AIEngine =
    | 'copilot'
    | 'claude-code'
    | 'gemini-cli'
    | 'openai-codex'
    | 'kimi-cli';

const credentials: Record<AIEngine, string[]> = {
    copilot: ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN'],
    'claude-code': ['ANTHROPIC_API_KEY'],
    'gemini-cli': ['GEMINI_API_KEY'],
    'openai-codex': ['OPENAI_API_KEY'],
    'kimi-cli': ['MOONSHOT_API_KEY'],
};

export async function runAI(
    engine: AIEngine,
    prompt: string,
    attachments: string[] = [],
    allowChanges = false,
) {
    const files = attachments.map(path => `Read the attachment at ${path}.`);
    const fullPrompt = [prompt, ...files].join('\n\n');

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
        switch (engine) {
            case 'copilot': {
                const args = attachments.flatMap(path => [
                    '--attachment',
                    path,
                ]);
                const { stdout } =
                    await $`pnpm dlx --package=@github/copilot@1.0.114 copilot --no-auto-update --no-custom-instructions --no-ask-user --disable-builtin-mcps --available-tools read --allow-tool read --silent -p ${fullPrompt} ${args}`;
                return stdout.trim();
            }
            case 'claude-code': {
                const permissions = allowChanges
                    ? [
                          '--permission-mode',
                          'bypassPermissions',
                          '--allow-dangerously-skip-permissions',
                      ]
                    : ['--tools', 'Read', '--permission-mode', 'plan'];
                const { stdout } =
                    await $`pnpm dlx --package=@anthropic-ai/claude-code@2.1.329 claude -p ${fullPrompt} --output-format text ${permissions}`;
                return stdout.trim();
            }
            case 'gemini-cli': {
                const permissions = allowChanges
                    ? ['--yolo']
                    : ['--allowed-tools', 'read_file'];
                const { stdout } =
                    await $`pnpm dlx --package=@google/gemini-cli@0.70.0 gemini --prompt ${fullPrompt} --output-format text ${permissions}`;
                return stdout.trim();
            }
            case 'openai-codex': {
                const sandbox = allowChanges ? 'workspace-write' : 'read-only';
                const auto = allowChanges ? ['--approve-for-me'] : [];
                const { stdout } =
                    await $`pnpm dlx --package=@openai/codex@0.171.0 codex exec --sandbox ${sandbox} --skip-git-repo-check ${auto} ${fullPrompt}`;
                return stdout.trim();
            }
            case 'kimi-cli': {
                const { stdout: response } =
                    await $`kimi --print -p ${fullPrompt} --final-message-only`;
                return response.trim();
            }
        }
    } finally {
        for (const [name, value] of savedCredentials) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
    }
}
