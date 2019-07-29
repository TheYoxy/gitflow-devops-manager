#!/usr/bin/env node

import Git, {FetchOptions, Reference} from 'nodegit';
import yargs from "yargs";
import './polyfills';

const pp = require('path');
// @ts-ignore
let argv = yargs.command('release <base> <target>', 'Create a new release', argv => {
    argv.positional('base', {
        describe: 'Base branch used to create a release',
        require: true
    }).positional('target', {
        describe: 'Target brache used to create a release',
        require: true
    });
}, async args => {
    const remoteOption: FetchOptions = {
        callbacks: {
            credentials: function () {
                return Git.Cred.userpassPlaintextNew('', '');
            }
        }
    };

    const path = args.path as string;
    console.log('Path: ', path);
    const repo = await Git.Repository.open(path);
    await repo.fetch('origin', remoteOption);

    async function extracted(branchName: string): Promise<Reference | null> {
        try {
            const baseBranch = await repo.getBranch(branchName);
            console.log(baseBranch);
            console.log(baseBranch.isRemote());
            return baseBranch;
        } catch (e) {
            console.error(e);
            return null;
        }
    }

    await extracted(args.base as string);
    await extracted(args.target as string);
    await extracted('MLdjsqlkjfmlksdqjm');
}).demandCommand()
    .option('path', {
        alias: 'p',
        describe: 'path to use',
        default: __dirname,
        string: true,
        global: true,
        normalize: true
    })
    .help('h')
    .alias('h', 'help')
    .alias('?', 'help').argv;