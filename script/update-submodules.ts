#! /usr/bin/env node

import { $ } from 'zx';

$.verbose = true;

await $`git submodule update --remote --recursive`;
