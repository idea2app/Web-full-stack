# Web Full-stack Scaffold

An automated testing, continuous integration, and continuous deployment scaffold for Node.js, Git, and Docker.

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

Install Chromium before running the browser tests:

```shell
pnpm exec playwright install chromium
```

The browser tests expect the browser scaffold to be running at `http://localhost:3000`.

[1]: https://nodejs.org/api/test.html
[2]: https://jestjs.io/docs/expect
[3]: https://jestjs.io/docs/mock-function-api
[4]: https://playwright.dev/
