import {getPersonalAccessTokenHandler, WebApi} from 'azure-devops-node-api';
import {IGitApi} from 'azure-devops-node-api/GitApi';
import {ResourceRef} from 'azure-devops-node-api/interfaces/common/VSSInterfaces';
import {GitPullRequest} from 'azure-devops-node-api/interfaces/GitInterfaces';
import {Identity} from 'azure-devops-node-api/interfaces/IdentitiesInterfaces';
import {ConnectionData} from 'azure-devops-node-api/interfaces/LocationsInterfaces';
import {WorkItem, WorkItemErrorPolicy, WorkItemType} from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import {IWorkItemTrackingApi} from 'azure-devops-node-api/WorkItemTrackingApi';
import chalk from 'chalk';
import config from 'config';
import Git, {Branch} from 'nodegit';
import * as shell from 'shelljs';
import * as winston from 'winston';
import yargs, {Argv} from 'yargs';
import {Arguments} from './arguments';
import {Context} from './context';
import {Repository} from './repository';
import {Type} from './type';
import Listr from 'listr';
import './polyfills';

shell.config.silent = true;

const logFile = new winston.transports.File(
  {
    dirname: 'logs',
    filename: 'out.log',
    level: 'debug',
    maxsize: 5242880, // 5MB
    maxFiles: 5,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.metadata({fillExcept: ['message', 'level', 'timestamp', 'label']}),
      winston.format.printf(
        ({level, message, timestamp, metadata}) => {
          let s = `[${timestamp}] ${level}: ${message}`;
          if (metadata) {
            s += ` ${JSON.stringify(metadata)}`;
          }
          return s;
        })
    ),
  });
const jsonLogFile = new winston.transports.File(
  {
    dirname: 'logs',
    filename: 'out.json.log',
    level: 'debug',
    maxsize: 5242880, // 5MB
    maxFiles: 5,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.metadata(),
      winston.format.prettyPrint({depth: 10, colorize: false})
    ),
  });
const logging = winston.createLogger(
  {
    transports: [logFile, jsonLogFile],
    exceptionHandlers: [logFile],
  });

// tslint:disable-next-line:ban-ts-ignore
// @ts-ignore
// tslint:disable-next-line:no-unused-expression
yargs.command<Arguments>('release <base> <target>', 'Create a new release', (argv: Argv<Arguments>) => {
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
}, async (args: Arguments) => {
  if (!shell.which('git')) {
    console.log(
      `${chalk.red("Couldn't find git installed on the system. Please install it before running again the CLI.")}`);
    logging.crit('Couldn\'t find git installed on the system');
    return;
  }

  logging.debug('Loaded configuration', {command: args._, args, config});

  const username = config.get<string>('Credentials.Username');
  const password = config.get<string>('Credentials.Token');

  const organization = 'AGBehome';
  const project = 'Behome';

  const remote = args.remote;
  const path = args.path;

  const generateTitle = false;

  const repo = await Repository.create(path, username, password, remote);

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
    task: () =>
      new Listr([{
        title: 'Fetching repository',
        task: () => (async (): Promise<void> => {
          logging.debug(`Fetching repository at path [${path}]`);
          await repo.fetch();
          logging.debug('Repository fetched');
        })(),
      }, {
        title: 'Extracting local branch',
        task: async (ctx: Context) => {
          const base = await checkBranch(args.base as string);
          if (!base) {
            throw new Error('Can\'t find branch ' + args.base + ' in the target repository');
          }
          ctx.baseBranch = base as Git.Reference;
        },
      }, {
        title: 'Extracting remote branch',
        task: async (ctx: Context) => {
          const target = await checkBranch(args.target as string);
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
        title: 'Fetching logs',
        task: (ctx: Context, task) => {
          logging.debug('Loading logs');
          const logs = shell.exec(
            `git log ${ctx.baseBranch.name()}..${ctx.targetBranch.name()} --pretty=%D%s%b --no-merges`)
            .toString();

          logging.debug('Extracting ids');

          const match: string[] = logs.match(/#\d{3,4}/g) as string[];
          logging.debug('Match checkBranch', {count: match.length});

          const ids: number[] = Array.from(new Set<number>(match.map(value =>
            Number(value.replace('#', ''))).sort()));
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
    task: () => new Listr<Context>(
      [{
        title: 'Loading work items',
        task: async (ctx: Context, task) => {
          const ids: number[] = ctx.ids;
          const n = Math.floor((ids.length / 200) + 1);

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
        task: async (ctx: Context) => {

          const types: WorkItemType[] = await workItemTracingApi.getWorkItemTypes(project);
          const d = Object.fromEntries(types.map<Type>(value => ({
            name: value.name!,
            items: ctx.workItems.filter(
              (wi: WorkItem) => wi && wi.fields && wi.fields!['System.WorkItemType'] === value.name),
          })).filter((value: Type) => value.items.length > 0).map((value: Type) => [value.name, value.items]));

          Object.getOwnPropertyNames(d).forEach(value => logging.info(`${value} ${d[value].length}`));
          //Todo make this configurable
          let msg = '';
          const order = ['Epic', 'Feature', 'User Story', 'Task', 'Bug', 'Defect'];

          const formatText = (v: string) => {
            if (d[v]) {
              const itemId = d[v].map((item: WorkItem) => {
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
          Object.getOwnPropertyNames(d).filter(value => !order.includes(value)).forEach(formatText);

          //logging.debug('Generated message: ', {message: msg});
          ctx.message = msg;
        },
      }, {
        title: 'Create title',
        task: async (ctx: Context, task) => {
          logging.debug('Creating title');
          ctx.title = `Release of ${new Date().toLocaleDateString()}`;
          task.output = 'Title: ' + ctx.title;
        },
      }, {
        title: 'Create pull request',
        task: async (ctx: Context) => {
          let pullRequest: GitPullRequest = {
            title: ctx.title,
            description: ctx.message,
            sourceRefName: ctx.baseBranch.name(),
            targetRefName: ctx.targetBranch.name(),
            workItemRefs: ctx.workItems.filter(item => item)
              .map<ResourceRef>((item: WorkItem) => ({id: item.id!.toString()})),
          };

          logging.debug('Pull request details', {
            title: pullRequest.title,
            source: pullRequest.sourceRefName,
            target: pullRequest.targetRefName,
            nb: pullRequest.workItemRefs!.length,
          });

          const repo = await gitApi.getRepositories(project);
          logging.debug('Downloaded remote git repository', {repositories: repo});
          if (repo.length === 0) {
            logging.crit('There isn\'t any repository linked to the selected project');
          } else {
            logging.warn(`Selecting first available repository ${repo[0].name}`);
          }

          pullRequest = await gitApi.createPullRequest(pullRequest, repo[0].id!);
          logging.info('Pull request created', {pullRequest});
        },
        skip: () => 'Not in production',
      }]),
  }]).run();

  async function checkBranch(branchName: string): Promise<Branch | null> {

    logging.debug('Extracting branch', {name: branchName});
    try {
      const branch = await repo.getBranch(branchName);
      logging.debug('Extraced branch', {branch});
      return branch;
    } catch (e) {
      try {
        const branch = await repo.getBranch(`${remote}/${branchName}`);
        logging.debug('Extraced branch', {branch});
        return branch;
      } catch (e) {
        // Branch doesn't exist
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
  .showHelpOnFail(false, 'Specify --help for available options')
  .help('h')
  .alias('h', 'help')
  .alias('?', 'help').argv;
