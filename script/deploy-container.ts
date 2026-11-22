#! /usr/bin/env node

import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { $, argv, fs, path } from 'zx';

$.verbose = true;

const scope = String(argv.scope ?? argv._[0] ?? '');
const configuration = {
    server: {
        image: 'idea2app/rest-node-ts',
        runtimeFile: '.env',
        runtime: `APP_SECRET=${process.env.APP_SECRET ?? ''}\n`,
    },
    browser: {
        image: 'idea2app/next-bootstrap-ts',
        runtimeFile: '.env.local',
        runtime: process.env.ENV_FILE ?? '',
    },
}[scope as 'server' | 'browser'];

if (!configuration) throw new Error('Scope must be server or browser.');

const { HOST, USER, SSH_KEY } = process.env;
delete process.env.APP_SECRET;
delete process.env.ENV_FILE;
delete process.env.HOST;
delete process.env.SSH_KEY;
delete process.env.USER;

const directory = await mkdtemp(path.join(tmpdir(), `deploy-${scope}-`));
const artifactPath = path.join(directory, 'artifact.tar');
const composePath = path.join(directory, 'docker-compose.yml');
const runtimePath = path.join(directory, configuration.runtimeFile);
const composeSource = path.join(scope, 'docker-compose.yml');
const remoteDirectory = `/tmp/web-full-stack-${scope}`;
const homeDirectory =
    scope === 'server' ? 'Web-full-stack' : 'Web-full-stack-browser';
const composeProject =
    scope === 'server' ? 'web-full-stack' : 'web-full-stack-browser';

try {
    await $`docker buildx build --platform linux/amd64 --tag ${configuration.image}:latest --output ${`type=docker,dest=${artifactPath}`} --file ${path.join(
        scope,
        'Dockerfile',
    )} ${scope}`;

    let compose = await fs.readFile(composeSource, 'utf8');
    if (scope === 'browser') {
        const service = '  next-bootstrap-ts:\n';
        if (!compose.includes(service))
            throw new Error('Could not locate the browser Compose service.');
        compose = compose.replace(
            service,
            `${service}    env_file:\n      - .env.local\n`,
        );
    }

    await writeFile(composePath, compose);
    await writeFile(runtimePath, configuration.runtime, { mode: 0o600 });

    if (!HOST) {
        console.log('HOST is not configured; skipping remote deployment.');
    } else {
        if (!USER || !SSH_KEY)
            throw new Error(
                'USER and SSH_KEY are required for remote deployment.',
            );

        const keyPath = path.join(directory, 'deploy-key');
        await writeFile(keyPath, SSH_KEY, { mode: 0o600 });
        await chmod(keyPath, 0o600);

        const sshOptions = [
            '-i',
            keyPath,
            '-o',
            'BatchMode=yes',
            '-o',
            'StrictHostKeyChecking=accept-new',
        ];
        const remote = `${USER}@${HOST}`;
        const targetDirectory = `~/${homeDirectory}`;

        await $`ssh ${sshOptions} ${remote} ${`mkdir -p ${remoteDirectory}`}`;
        await $`scp ${sshOptions} ${artifactPath} ${composePath} ${runtimePath} ${`${remote}:${remoteDirectory}/`}`;
        await $`ssh ${sshOptions} ${remote} ${`set -e; mkdir -p ${targetDirectory}; mv ${remoteDirectory}/docker-compose.yml ${targetDirectory}/docker-compose.yml; mv ${remoteDirectory}/${configuration.runtimeFile} ${targetDirectory}/${configuration.runtimeFile}; docker load --input ${remoteDirectory}/artifact.tar; rm -rf ${remoteDirectory}; cd ${targetDirectory}; docker compose -p ${composeProject} up --detach --remove-orphans`}`;
    }
} finally {
    await rm(directory, { recursive: true, force: true });
}
