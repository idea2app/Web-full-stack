#! /usr/bin/env node

import { $ } from 'zx';

$.verbose = true;

const { VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID } = process.env;

if (!VERCEL_TOKEN || !VERCEL_ORG_ID || !VERCEL_PROJECT_ID) {
    console.log('Vercel credentials are not configured; skipping deployment.');
    process.exit(0);
}

const deploymentArgs =
    process.env.GITHUB_REF === 'refs/heads/main' ? ['--prod'] : [];

await $`pnpm exec vercel deploy ./browser --yes --non-interactive ${deploymentArgs}`;
