#!/usr/bin/env node

import Git, {FetchOptions, Reference} from 'nodegit';
import yargs from "yargs";
import './polyfills';
import winston, {format} from "winston";
import Listr from "listr";
import config from "config";

const {combine, timestamp, label, printf, colorize} = format;

const logging = winston.createLogger({
    transports: [
        new winston.transports.Console({
            level: 'info',
            format: combine(
                colorize(),
                printf(({message}) => {
                    return `${message}`;
                })
            )
        }),
        new winston.transports.File({
            filename: 'out.log',
            level: 'debug',
            format: combine(
                label({label: 'This is a label'}),
                timestamp(),
                printf(({level, message, label, timestamp}) => {
                    return `${timestamp} [${label}] ${level}: ${message}`;
                })
            ),
        }),
    ]
});

// @ts-ignore
// tslint:disable-next-line: no-unused-expression
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
    const fetchOptions: FetchOptions = {
        callbacks: {
            credentials() {
                return Git.Cred.userpassPlaintextNew(config.get('GitCredentials.Username')
                    , config.get('GitCredentials.Token'));
            },
        }
    };
    const remote = args.remote as string;
    const path = args.path as string;

    const repo = await Git.Repository.open(path);
    await new Listr([{
        title: 'git',
        task: () =>
            new Listr([{
                title: 'Fetching repository',
                task: () => fetch(),
            }, {
                title: 'Extracting branches',
                task: async (ctx) => {
                    await extracted(args.base as string).then(r => ctx.baseBranch = r);
                    await extracted(args.target as string).then(r => ctx.targetBranch = r);
                }
            }])
    }]).run();
    async function fetch(): Promise<void> {
        logging.debug(`Fetching repository at path [${path}]`);
        await repo.fetch(remote, fetchOptions);
        logging.info('Repository fetched');
    }

    async function extracted(branchName: string): Promise<Reference | null> {
        logging.debug(`Extracting ${branchName}`);
        try {
            const branch = await repo.getBranch(branchName);
            logging.info(`Extraced ${branch}`);
            return branch;
        } catch (e) {
            // Doesn't exist locally
            if (!branchName.includes(remote)) {
                return await extracted(`${remote}/${branchName}`);
            } else {
                logging.error(`Couldn't find branch ${branchName.replace(branchName, branchName.replace(`${remote}/`, ''))}`);
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
    .help('h')
    .alias('h', 'help')
    .alias('?', 'help').argv;
