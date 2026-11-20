# Web full-stack scaffold

A development scaffold for full-stack Web projects built with TypeScript.

## Guide document

https://idea2app.feishu.cn/docs/doccnlKWBaT81RyNXAsHDIWFwph

## Technology stack

1. Test runner: [Node.js test runner][1]
2. Assertions and mocks: [Jest expect][2] and [Jest mock][3]
3. Browser automation: [Playwright][4]

## Tests

Use Node.js 26 and pnpm 12:

```shell
pnpm install
pnpm test
```

The browser tests expect the browser scaffold to be running at `http://localhost:3000`.

## Requirement automation

Requirement issues can target multiple scaffold directories and select Copilot, Claude Code, Gemini CLI, OpenAI Codex, or Kimi CLI. Add the selected provider's API token as a repository secret: `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, or `MOONSHOT_API_KEY`. Copilot uses the workflow token unless `COPILOT_GITHUB_TOKEN` is configured.

The workflow first textifies the issue and attachments, then opens a review pull request that queues the requirement in `/task.yml`. Merging that change triggers requirement analysis and task issue creation.

[1]: https://nodejs.org/api/test.html
[2]: https://jestjs.io/docs/expect
[3]: https://jestjs.io/docs/mock-function-api
[4]: https://playwright.dev/
