#!/usr/bin/env node
import {getPersonalAccessTokenHandler, WebApi} from 'azure-devops-node-api';
import {IGitApi} from 'azure-devops-node-api/GitApi';
import {ResourceRef} from 'azure-devops-node-api/interfaces/common/VSSInterfaces';
import {GitPullRequest, GitRepository} from 'azure-devops-node-api/interfaces/GitInterfaces';
import {Identity} from 'azure-devops-node-api/interfaces/IdentitiesInterfaces';
import {ConnectionData} from 'azure-devops-node-api/interfaces/LocationsInterfaces';
import {WorkItem, WorkItemErrorPolicy, WorkItemType} from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import {IWorkItemTrackingApi} from 'azure-devops-node-api/WorkItemTrackingApi';
import chalk from 'chalk';
import config from 'config';
import Listr from 'listr';
import Git, {Reference} from 'nodegit';
import * as shell from 'shelljs';
import * as winston from 'winston';
import yargs, {Argv} from 'yargs';
import {Arguments} from './arguments';
import {Context} from './context';
import {logging} from './logging';
import './polyfills';
import {Repository} from './repository';
import {Type} from './type';

shell.config.silent = true;

// tslint:disable-next-line:ban-ts-ignore
// @ts-ignore
// tslint:disable-next-line:no-unused-expression
yargs.command<Arguments>('release <base> <target>', 'Create a new release', (argv: Argv<Arguments>): void => {
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
}, async (args: Arguments): Promise<void> => {
  if (!shell.which('git')) {
    console.log(
      `${chalk.red("Couldn't find git installed on the system. Please install it before running again the CLI.")}`);
    logging.crit('Couldn\'t find git installed on the system');
    return;
  }

  logging.debug('Loaded configuration', {command: args._, args, config});

  const username: string = config.get<string>('Credentials.Username');
  const password: string = config.get<string>('Credentials.Token');
  const organization = config.get<string>('AzureDevops.Organization');
  const project = config.get<string>('AzureDevops.Project');

  const remote: string = args.remote;
  const path: string = args.path;

  const generateTitle = false;

  const repo: Repository = await Repository.create(path, username, password, remote);

  if (repo == null) {
    logging.crit('Couldn\'t find any git repo', {path});
    return;
  } else {
    logging.debug('Opened git repository', {path});
  }

  const api: WebApi = new WebApi(`https://dev.azure.com/${organization}`, getPersonalAccessTokenHandler(password));
  logging.debug('Connected to devops', {organization, project});

  const connectionData: ConnectionData = await api.connect();
  const user: Identity = connectionData.authenticatedUser as Identity;
  if (user == null) {
    logging.crit('Couldn\'t connect to azure devops. Please check your configuration.');
    return;
  } else {
    logging.info(`Connected as ${user.providerDisplayName}`);
  }

  const workItemTracingApi: IWorkItemTrackingApi = await api.getWorkItemTrackingApi();
  const gitApi: IGitApi = await api.getGitApi();
  logging.debug('Loaded services for devops');

  logging.debug('Starting command');
  await new Listr<Context>([{
    title: 'git',
    task: (): Listr<Context> =>
      new Listr([{
        title: 'Fetching repository',
        task: (): Promise<void> => (async (): Promise<void> => {
          logging.debug(`Fetching repository at path [${path}]`);
          await repo.fetch();
          logging.debug('Repository fetched');
        })(),
      }, {
        title: `Synchronising ${chalk.blue(args.base)} branch`,
        task: async (ctx: Context): Promise<void> => {
          const base: Reference | null = await repo.checkBranch(args.base);
          if (!base) {
            throw new Error('Can\'t find branch ' + args.base + ' in the target repository');
          }
          ctx.baseBranch = base as Git.Reference;
        },
      }, {
        title: `Extracting ${chalk.blue(args.target)} branch`,
        task: async (ctx: Context): Promise<void> => {
          const target: Reference | null = await repo.checkBranch(args.target);
          if (!target) {
            throw new Error('Can\'t find branch ' + args.base + ' in the target repository');
          }
          ctx.targetBranch = target as Git.Reference;
        },
      }, {
        title: `Counting diff between ${chalk.blue(args.base)} and ${chalk.blue(args.target)}`,
        task: (ctx: Context, task): void => {
          logging.debug(`Switching directory to ${path}`);
          shell.cd(path);

          logging.debug('Getting nb of ahead commits');
          const ahead: string = shell.exec(
            `git rev-list ${ctx.baseBranch.name()}..${ctx.targetBranch.name()} --count --no-merges`)
            .toString().trim();
          logging.info(`Ahead: ${ahead}`);

          logging.debug('Getting nb of behind commits');
          const behind: string = shell.exec(
            `git rev-list ${ctx.targetBranch.name()}..${ctx.baseBranch.name()} --count --no-merges`)
            .toString().trim();
          logging.info(`Behind: ${behind}`);

          if (Number(ahead.toString()) === 0) {
            throw new Error('Branches should have differences to create api new release.');
          }

          task.output = `< ${ahead} --- ${behind}>`;
        },
      }, {
        title: 'Fetching logs',
        task: (ctx: Context, task): void => {
          logging.debug('Loading logs');
          const logs: string = shell.exec(
            `git log ${ctx.baseBranch.name()}..${ctx.targetBranch.name()} --pretty=%D%s%b --no-merges`)
            .toString();

          logging.debug('Extracting ids');

          const match: string[] = logs.match(/#\d{3,4}/g) as string[];
          logging.debug('Match checkBranch', {count: match.length});

          const ids: number[] = Array.from(new Set<number>(match.map((value): number =>
                                                                       Number(value.replace('#', '')))
                                                             .sort((a: number, b: number): number => {
                                                               if (a < b) {
                                                                 return -1;
                                                               } else if (a > b) {
                                                                 return 1;
                                                               } else {
                                                                 return 0;
                                                               }
                                                             })));

          if (ids.length > 0) {
            task.output = `Extracted ${ids.length} id${ids.length > 1 ? 's' : ''}`;
            logging.debug('Ids checkBranch', {count: ids.length});
          } else {
            logging.warn('No ids has been checkBranch');
          }

          ctx.ids = ids;
        },
      }]),
  }, {
    title: 'Azure devops',
    task: (): Listr<Context> => new Listr<Context>(
      [{
        title: 'Loading work items',
        task: async (ctx: Context, task): Promise<void> => {
          const ids: number[] = ctx.ids;
          const n: number = Math.floor((ids.length / 200) + 1);

          logging.debug(`Loading work items in ${n} requests`, {count: n});

          const id = 'Loading all work items';
          const t: winston.Profiler = logging.startTimer();
          let wi: WorkItem[] = [];
          for (let i = 0; i < n; i++) {
            const timer: winston.Profiler = logging.startTimer();
            task.output = `Request ${i + 1} on ${n}`;
            const arr: WorkItem[] = await workItemTracingApi.getWorkItems(ids.slice(i * 200, (i + 1) * 200), undefined,
                                                                          undefined, undefined,
                                                                          WorkItemErrorPolicy.Omit, project);
            timer.done({message: 'Loading work items', step: {count: i + 1, total: n}, count: arr.length});
            wi = [...wi, ...arr];
          }
          t.done({message: id});
          logging.info('Loaded work items', {count: wi.length});
          ctx.workItems = wi;
        },
      }, {
        title: 'Create message',
        task: async (ctx: Context): Promise<void> => {

          const types: WorkItemType[] = await workItemTracingApi.getWorkItemTypes(project);
          const d = Object.fromEntries(types.map<Type>((value): { name: string; items: WorkItem[] } => ({
            name: value.name!,
            items: ctx.workItems.filter(
              (wi: WorkItem): undefined | boolean => wi && wi.fields && wi.fields['System.WorkItemType'] === value.name),
          }))
                                         .filter((value: Type): boolean => value.items.length > 0)
                                         .map((value: Type): Array<string | WorkItem[]> => [value.name, value.items]));

          Object.getOwnPropertyNames(d).forEach((value): winston.Logger => logging.info(`${value} ${d[value].length}`));
          //Todo make this configurable
          let msg = '';
          const order: string[] = ['Epic', 'Feature', 'User Story', 'Task', 'Bug', 'Defect'];

          const formatText: (v: string) => void = (v: string): void => {
            if (d[v]) {
              const itemId = d[v].map((item: WorkItem): string | null => {
                if (item.fields) {
                  const fields: { [p: string]: string } = item.fields;
                  if (generateTitle) {
                    return `#${item.id} - ${fields['System.Title']}`;
                  } else {
                    return `#${item.id}`;
                  }
                }
                return null;
              });
              if (itemId) {
                msg += `## ${v}:\n\n${itemId.join('\n')}\n\n---\n\n`;
              }
            }
          };

          order.forEach(formatText);
          Object.getOwnPropertyNames(d).filter((value): boolean => !order.includes(value)).forEach(formatText);

          ctx.message = msg;
        },
      }, {
        title: 'Create title',
        task: async (ctx: Context, task): Promise<void> => {
          logging.debug('Creating title');
          ctx.title = `Release of ${new Date().toLocaleDateString()}`;
          task.output = 'Title: ' + ctx.title;
        },
      }, {
        title: 'Create pull request',
        task: async (ctx: Context): Promise<void> => {
          let pullRequest: GitPullRequest = {
            title: ctx.title,
            description: ctx.message,
            sourceRefName: ctx.baseBranch.name(),
            targetRefName: ctx.targetBranch.name(),
            workItemRefs: ctx.workItems.filter((item): WorkItem => item)
              .map<ResourceRef>((item: WorkItem): { id: string } => ({id: item.id!.toString()})),
          };

          logging.debug('Pull request details', {
            pullRequest,
            nbItems: pullRequest.workItemRefs!.length,
          });

          const repo: GitRepository[] = await gitApi.getRepositories(project);
          logging.debug('Downloaded remote git repository', {repositories: repo});

          if (repo.length === 0) {
            logging.crit('There isn\'t any repository linked to the selected project');
          } else {
            logging.warn(`Selecting first available repository ${repo[0].name}`, {repo: repo[0]});
          }

          pullRequest = await gitApi.createPullRequest(pullRequest, repo[0].id!);
          logging.info('Pull request created', {pullRequest});
        },
        skip: (): 'Not in production' => 'Not in production',
      }]),
  }]).run();
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
