import { strict as assert } from 'node:assert';
import { mock } from 'node:test';
import * as zx from 'zx';

const names = [
    'COPILOT_GITHUB_TOKEN',
    'GH_TOKEN',
    'OPENAI_API_KEY',
    'GEMINI_API_KEY',
    'ANTHROPIC_API_KEY',
    'QODER_PERSONAL_ACCESS_TOKEN',
    'MOONSHOT_API_KEY',
    'KILO_CONFIG_CONTENT',
];
for (const name of names) process.env[name] = name;

let command;
let environment;

function $(strings, ...values) {
    command = strings.reduce(
        (result, part, index) =>
            result +
            part +
            (index < values.length
                ? Array.isArray(values[index])
                    ? values[index].join(' ')
                    : values[index]
                : ''),
        '',
    );
    environment = Object.fromEntries(
        names.map(name => [name, process.env[name]]),
    );
    return (async function* () {
        yield 'output';
    })();
}

mock.module('zx', { exports: { ...zx, $ } });
const { runAI } = await import('../script/utility.ts');
const cases = [
    [
        'copilot',
        [
            '--autopilot',
            '--allow-all',
            '--trust-folder',
            '--enable-all-github-mcp-tools',
            '--allow-all-mcp-server-instructions',
        ],
        ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN'],
    ],
    [
        'openai-codex',
        ['--dangerously-bypass-approvals-and-sandbox'],
        ['OPENAI_API_KEY'],
    ],
    ['gemini-cli', ['--yolo'], ['GEMINI_API_KEY']],
    [
        'claude-code',
        ['--permission-mode bypassPermissions'],
        ['ANTHROPIC_API_KEY'],
    ],
    [
        'qoder-cli',
        ['--dangerously-skip-permissions'],
        ['QODER_PERSONAL_ACCESS_TOKEN'],
    ],
    ['kimi-cli', ['--print', '--afk'], ['MOONSHOT_API_KEY']],
    ['kilo-cli', ['--auto'], ['KILO_CONFIG_CONTENT']],
];
for (const [engine, options, allowed] of cases) {
    assert.deepEqual(
        await Array.fromAsync(runAI(engine, 'prompt', ['attachment.txt'])),
        ['output'],
    );
    for (const option of options)
        assert.ok(command.includes(option), engine + ': ' + option);
    assert.ok(command.includes('attachment.txt'), engine);
    assert.doesNotMatch(
        command,
        /--available-tools|--no-custom-instructions|--disable-builtin-mcps|--deny-tool|--approval-mode plan|--tools Read|--sandbox read-only/,
    );
    for (const name of names) {
        assert.equal(
            environment[name],
            allowed.includes(name) || name === 'GH_TOKEN' ? name : undefined,
            engine + ': ' + name,
        );
        assert.equal(process.env[name], name, name + ' restored');
    }
}
