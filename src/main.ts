#!/usr/bin/env node

import {getPersonalAccessTokenHandler, WebApi} from 'azure-devops-node-api';
import {Identity} from 'azure-devops-node-api/interfaces/IdentitiesInterfaces';
import {ConnectionData} from 'azure-devops-node-api/interfaces/LocationsInterfaces';
import {WorkItem, WorkItemErrorPolicy} from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import {IWorkItemTrackingApi} from 'azure-devops-node-api/WorkItemTrackingApi';
import chalk from 'chalk';
import config from 'config';
import Listr from 'listr';
import Git, {FetchOptions, Reference} from 'nodegit';
import shell from 'shelljs';
import winston, {format} from 'winston';
import yargs from 'yargs';
import {Context} from './context';
import './polyfills';

shell.config.silent = true;

const {combine, timestamp, printf} = format;
const logFile = new winston.transports.File(
  {
    dirname: 'logs',
    filename: 'out.log',
    level: 'debug',
    maxsize: 5242880, // 5MB
    maxFiles: 5,
    format: combine(
      timestamp(),
      printf(
        ({level, message, timestamp}) => {
          return `[${timestamp}] ${level}: ${message}`;
        })
    ),
  });
const logging = winston.createLogger(
  {
    transports: [logFile],
    exceptionHandlers: [logFile],
  });

// tslint:disable-next-line:ban-ts-ignore
// @ts-ignore
// tslint:disable-next-line:no-unused-expression
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
}, async (args: { _: string[], remote: string; path: string; base: string; target: string; }) => {

  if (!shell.which('git')) {
    console.log(
      `${chalk.red("Couldn't find git installed on the system. Please install it before running again the CLI.")}`);
    logging.crit('Couldn\'t find git installed on the system');
    return;
  }

  logging.debug(`Command used: ${args._}`);
  logging.debug(`Loaded configuration: ${JSON.stringify(args, undefined)}`);
  logging.debug(`Loaded configuration: ${JSON.stringify(config, undefined)}`);

  const fetchOptions: FetchOptions = {
    callbacks: {
      credentials() {
        return Git.Cred.userpassPlaintextNew(username
          , password);
      },
    },
  };
  const username = config.get('Credentials.Username') as string;
  const password = config.get('Credentials.Token') as string;

  const remote = args.remote as string;
  const path = args.path as string;

  const repo = await Git.Repository.open(path);
  if (repo == null) {
    logging.crit('Couldn\'t find any git repo ');
    return;
  } else {
    logging.debug('Ope');
  }

  const api: WebApi = new WebApi('https://dev.azure.com/AGBehome', getPersonalAccessTokenHandler(password));

  logging.debug('Connecting to devops');
  const connectionData: ConnectionData = await api.connect();
  const user: Identity = connectionData.authenticatedUser as Identity;
  if (user == null) {
    logging.crit('Couldn\'t connect to azure devops. Please check your configuration.');
    return;
  } else {
    logging.info(`Connected as ${user.providerDisplayName}`);
  }

  const workItemTracingApi: IWorkItemTrackingApi = await api.getWorkItemTrackingApi();
  logging.debug('Starting command');
  await new Listr([{
    title: 'git',
    task: () =>
      new Listr([{
        title: 'Fetching repository',
        task: () => (async (): Promise<void> => {
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
        title: 'Extracting remote branch',
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
          logging.debug(`Switching directory to ${path}`);
          shell.cd(path);

          logging.debug('Getting nb of ahead commits');
          const ahead = shell.exec(
            `git rev-list ${ctx.baseBranch.name()}..${ctx.targetBranch.name()} --count --no-merges`)
            .toString().trim();
          logging.info(`Ahead: ${ahead}`);

          logging.debug('Getting nb of behind commits');
          const behind = shell.exec(
            `git rev-list ${ctx.targetBranch.name()}..${ctx.baseBranch.name()} --count --no-merges`)
            .toString().trim();
          logging.info(`Behind: ${behind}`);

          if (Number(ahead.toString()) === 0) {
            throw new Error('Branches should have differences to create api new release.');
          }
        },
      }, {
        title: 'Fetching logs', task: (ctx: Context) => {
          logging.debug('Loading logs');
          const logs = shell.exec(
            `git log ${ctx.baseBranch.name()}..${ctx.targetBranch.name()} --pretty=%D%s%b --no-merges`)
            .toString();

          logging.debug('Extracting ids');

          const match: string[] = logs.match(/#\d{3,4}/g) as string[];
          logging.debug(`Extracted ${match.length} items`);

          const ids: number[] = Array.from(new Set<number>(match.map(value =>
                                                                       Number(value.replace('#', ''))).sort()));
          if (ids.length > 0) {
            logging.debug(`Extracted ${ids.length} id${ids.length > 1 ? 's' : ''}`);
          } else {
            logging.warn('No ids has been extracted');
          }

          ctx.ids = ids;
        },
      }]),
  }, {
    title: 'Azure devops',
    task: () => new Listr(
      [{
        title: 'Loading work items',
        task: async (ctx: Context) => {
          const ids: number[] = ctx.ids;
          const n = Math.floor((ids.length / 200) + 1);

          logging.debug(`Loading work items in ${n} requests`);

          const id = 'Loading work items';
          logging.profile(id);
          let wi: WorkItem[] = [];
          for (let i = 0; i < n; i++) {
            const arr: WorkItem[] = await workItemTracingApi.getWorkItems(ids.slice(i * 200, (i + 1) * 200), undefined,
                                                                          undefined, undefined,
                                                                          WorkItemErrorPolicy.Omit, 'Behome');
            logging.debug(`[${i + 1}/${n}] loaded ${arr.length} items`);
            wi = [...wi, ...arr];
          }
          logging.profile(id);

          logging.info(`Loaded ${wi.length} work items`);
          ctx.workItems = wi;
        },
      }]),
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
