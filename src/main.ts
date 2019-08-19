#!/usr/bin/env node

import chalk from 'chalk';
import config from "config";
import Listr from "listr";
import Git, {FetchOptions, Reference} from 'nodegit';
import shell from 'shelljs';
import winston, {format} from "winston";
import yargs from "yargs";
import {Context} from './context';
import './polyfills';

shell.config.silent = true;

const {combine, timestamp, printf} = format;

const logging = winston.createLogger(
    {
        transports: [
            new winston.transports.File(
                {
                    filename: 'out.log',
                    level: 'debug',
                    format: combine(
                        timestamp(),
                        printf(
                            ({level, message, timestamp}) => {
                                return `${timestamp} ${level}: ${message}`;
                            })
                    ),
                }),
        ],
    });

// tslint:disable-next-line: no-unused-expression
// @ts-ignore
yargs.command('release <base> <target>', 'Create a new release', argv => {
    argv.positional('base', {
        describe: 'Base branch used to create a release',
        require: true,
    }).positional('target', {
        describe: 'Target branch used to create a release',
        require: true,
    }).option('remote', {
        alias: 'r',
        describe: 'Remote repository to use',
        default: 'origin',
    });
}, async (args: { remote: string; path: string; base: string; target: string; }) => {

    if (!shell.which('git')) {
        console.log(`${chalk.red(
            "Couldn't find git installed on the system. Please install it before running again the CLI.")}`);
        logging.crit('Couldn\'t find git installed on the system');
        process.exit(-1);
    }

    const fetchOptions: FetchOptions = {
        callbacks: {
            credentials() {
                return Git.Cred.userpassPlaintextNew(config.get('GitCredentials.Username')
                    , config.get('GitCredentials.Token'));
            },
        },
    };
    const remote = args.remote as string;
    const path = args.path as string;

    const repo = await Git.Repository.open(path);

    await new Listr([{
        title: 'git',
        task: () =>
            new Listr([{
                title: 'Fetching repository',
                task: () => (async function (): Promise<void> {
                    logging.debug(`Fetching repository at path [${path}]`);
                    await repo.fetch(remote, fetchOptions);
                    logging.debug('Repository fetched');
                })(),
            }, {
                title: 'Extracting local branch',
                task: async (ctx: Context) => {
                    const base = await extracted(args.base as string);
                    if (!base) {
                        throw new Error('Can\'t find branch ' + args.base + ' in the target repository');
                    }
                    ctx.baseBranch = base as Git.Reference;
                },
            }, {
                title: "Extracting remote branch",
                task: async (ctx: Context) => {
                    const target = await extracted(args.target as string);
                    if (!target) {
                        throw new Error('Can\'t find branch ' + args.base + ' in the target repository');
                    }
                    ctx.targetBranch = target as Git.Reference;
                },
            }, {
                title: 'Counting diff',
                task: (ctx: Context) => {
                    shell.cd(path);
                    const ahead = shell.exec(
                        `git rev-list ${ctx.baseBranch.name()}..${ctx.targetBranch.name()} --count --no-merges`)
                        .toString().trim();
                    const behind = shell.exec(
                        `git rev-list ${ctx.targetBranch.name()}..${ctx.baseBranch.name()} --count --no-merges`)
                        .toString().trim();

                    logging.debug(`Ahead: ${ahead}`);
                    logging.debug(`Behind: ${behind}`);

                    if (parseInt(ahead.toString(), 10) == 0) {
                        throw new Error('Branches should have differences to create a new release.');
                    }
                },
            }, {
                title: 'Fetching logs', task: (ctx: Context) => {
                    logging.debug('Loading logs');
                    const logs = shell.exec(
                        `git log ${ctx.baseBranch.name()}..${ctx.targetBranch.name()} --pretty=%D%s%b --no-merges`)
                        .toString();

                    logging.debug('Extracting ids');
                    const ids = Array.from(new Set(logs.match(/#\d{3,4}/g))).sort()
                        .map(value => parseInt(value.replace('#', '')));

                    logging.debug(`Extracted ${ids.length} id${ids.length > 1 ? 's' : ''}`);
                    ctx.ids = ids;
                }
            },]),
    }]).run();

    async function extracted(branchName: string): Promise<Reference | null> {
        logging.debug(`Extracting ${branchName}`);
        try {
            const branch = await repo.getBranch(branchName);
            logging.debug(`Extraced ${branch}`);
            return branch;
        } catch (e) {
            // Doesn't exist locally
            if (!branchName.includes(remote)) {
                return extracted(`${remote}/${branchName}`);
            } else {
                logging.error(
                    `Couldn't find branch ${branchName.replace(branchName, branchName.replace(`${remote}/`, ''))}`);
                return null;
            }
        }
    }
}).demandCommand()
    .option('path', {
        alias: 'p',
        describe: 'path to use',
        default: __dirname,
        string: true,
        global: true,
        normalize: true,
    })
    .showHelpOnFail(false, 'Specify --help for available options')
    .help('h')
    .alias('h', 'help')
    .alias('?', 'help').argv;
