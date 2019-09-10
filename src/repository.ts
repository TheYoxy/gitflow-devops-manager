import fs from 'fs';
import Git, {Branch, Commit, FetchOptions, Merge, Reference, Remote, Reset} from 'nodegit';
import {logging} from './logging';

export class Repository {
  private readonly _path: string;
  private _repo!: Git.Repository;
  private readonly _remoteOptions: FetchOptions;
  private readonly _remoteName: string;
  private _remote!: Remote;

  private constructor(path: string, fetchOptions: FetchOptions, remoteName = 'origin') {
    this._path = path;
    this._remoteOptions = fetchOptions;
    this._remoteName = remoteName;
  }

  get remoteName(): string {
    return this._remoteName;
  }

  static async create(path: string, username: string, password: string, remote = 'origin'): Promise<Repository> {
    if (!path) {
      throw new Error('Path is empty');
    }
    if (!fs.statSync(path).isDirectory()) {
      throw new Error('Path doesn\'t exist');
    }

    const repo = new Repository(path, {
      callbacks: {
        credentials() {
          return Git.Cred.userpassPlaintextNew(username, password);
        },
      },
    }, remote);
    await repo.init();
    return repo;
  }

  async isLocal(branchName: string): Promise<boolean> {
    try {
      await this._repo.getBranch(branchName);
      return true;
    } catch (e) {
      // logging.error('isLocal error', {label: 'isLocal', error: e, branchName});
      return false;
    }
  }

  async isRemote(branchName: string): Promise<boolean> {
    try {
      await this._repo.getBranch(`${this._remoteName}/${branchName}`);
      return true;
    } catch (e) {
      // logging.error('isRemote error', {label: 'isRemote', error: e, branchName});
      return false;
    }
  }

  async fetch(): Promise<void> {
    try {
      await this._repo.fetch(this._remoteName, this._remoteOptions);
    } catch (e) {
      console.log('Fetch error:', e);
    }
  }

  async getBranch(branchName: string): Promise<Reference | null> {
    try {
      return await this._repo.getReference(branchName);
    } catch (e) {
      logging.error('getBranch error', {label: 'getBranch', error: e, branchName});
      return null;
    }
  }

  async pull(branchName: string): Promise<boolean> {
    try {
      const from = `refs/remotes/${this._remoteName}/${branchName}`;
      if (!await this.isLocal(branchName)) {
        logging.debug('Branch doesn\'t exist locally', {branchName});
        await this.createBranchFromRemote(branchName, branchName);
      } else {
        logging.debug('Branch pulled by merging', {
          label: 'pull',
          branchName,
          remoteName: this._remoteName,
          remote: this._remote,
        });

        await this._repo.mergeBranches(branchName, from, undefined,
                                       Merge.PREFERENCE.FASTFORWARD_ONLY);
      }
      return true;
    } catch (e) {
      logging.error('pull error',
                    {
                      label: 'pull',
                      error: e,
                      branchName,
                      remoteName: this._remoteName,
                      remote: this._remote,
                    });
      return false;
    }
  }

  async push(branchName: string): Promise<boolean> {
    try {
      await this._remote.push([`refs/heads/${branchName}:refs/heads/${branchName}`], this._remoteOptions);
      return true;
    } catch (e) {
      logging.error('push error', {label: 'push', error: e, branchName});
      return false;
    }
  }

  async checkout(branchName: string): Promise<Reference> {
    return this._repo.checkoutBranch(branchName);
  }

  async checkBranch(branchName: string): Promise<Branch | null> {
    const logObj = {label: 'checkbranch', branchName, remoteName: this._remoteName};
    logging.debug(`Checking if branch ${branchName} exist in local`, logObj);
    if (await this.isLocal(branchName)) {
      logging.debug(`Branch ${branchName} exist locally`, logObj);
      logging.debug(`Checking if branch exist in the remote ${this._remoteName}`, logObj);
      if (await this.isRemote(branchName)) {
        logging.debug(`Branch ${branchName} exist in the remote.`, logObj);
        logging.debug('Syncing branches');
        //todo sync method
        await this.syncBranch(branchName);
      } else {
        logging.warn(`Branch ${branchName} doesn\'t exist in the remote ${this._remoteName}`, logObj);
        logging.debug(`Pushing branch ${branchName} in the remote ${this._remoteName}`, logObj);
        if (!await this.push(branchName)) {
          logging.crit(`Unable to push branch ${branchName} to remote ${this._remoteName}`, logObj);
          throw new Error(`Unable to push branch ${branchName}`);
        } else {
          logging.info(`Branch ${branchName} has been successfully pushed on remote ${this._remoteName}`, logObj);
          return this.getBranch(branchName);
        }
      }
    } else {
      logging.warn(`Branch ${branchName} doesn\'t exist locally`, logObj);
      logging.debug(`Looking for branch in the remote ${this._remoteName}`, logObj);
      if (await this.isRemote(branchName)) {
        logging.debug(`Branch ${branchName} exist in the remote ${this._remoteName}`, logObj);
        logging.debug(`Pulling branch ${branchName} locally`, {branchName});
        if (!await this.pull(branchName)) {
          logging.crit(`Unable to pull branch ${branchName} from remote ${this._remoteName}`, logObj);
          throw new Error(`Unable to pull branch ${branchName}`);
        } else {
          logging.debug(`Branch ${branchName} successfully pulled from remote ${this._remoteName}`, logObj);
          return this.getBranch(branchName);
        }
      } else {
        logging.crit(`Unable to find branch ${branchName} in the repository`, logObj);
        throw new Error(`Unable to find branch ${branchName} in the repository`);
      }
    }
    return null;
  }

  async compareBranch(sourceBranchName: string, targetBranchName: string) {
    const sourceBranch: Reference | null = await this.getBranch(sourceBranchName);
    const targetBranch: Reference | null = await this.getBranch(targetBranchName);
    if (sourceBranch && targetBranch) {
      const cmp = sourceBranch.target().cmp(targetBranch.target());
      if (cmp < 0) {
        return BranchState.Behind;
      } else if (cmp > 0) {
        return BranchState.Ahead;
      } else {
        return BranchState.Equals;
      }
    } else {
      const msg: string[] = [];
      if (!sourceBranch) {
        msg.push(`${sourceBranchName} branch`);
        logging.error(`Branch ${sourceBranchName} doesn't exist`,
                      {label: 'compareBranch', sourceBranch: sourceBranchName});
      }
      if (!targetBranch) {
        msg.push(`${targetBranchName} branch`);
        logging.error(`Branch ${targetBranchName} doesn't exist`,
                      {label: 'compareBranch', targetBranch: targetBranchName});
      }
      throw new Error(msg.join('and') + ' doesn\'t exist');
    }
  }

  async syncBranch(branchName: string) {
    const branchStatus: BranchState = await this.compareBranch(branchName, this.remoteName + '/' + branchName);
    const logObj = {label: 'syncBranch', branchName, remoteName: this.remoteName};
    // tslint:disable-next-line:switch-default
    switch (branchStatus) {
      case BranchState.Ahead:
        logging.info(`Pushing ${branchName} to remote ${this.remoteName}`, logObj);
        if (!await this.push(branchName)) {
          logging.crit(`Unable to push branch ${branchName} to remote ${this._remoteName}`, logObj);
          throw new Error(`[syncBranch]: Unable to push branch ${branchName}`);
        }
        break;
      case BranchState.Behind:
        logging.info(`Pulling ${branchName} from remote ${this.remoteName}`, logObj);
        if (!await this.pull(branchName)) {
          logging.crit(`Unable to pull branch ${branchName} from remote ${this._remoteName}`, logObj);
          throw new Error(`[syncBranch]: Unable to pull branch ${branchName}`);
        }
        break;
      case BranchState.Equals:
        logging.info(`${branchName} is already synchronized with ${this.remoteName}`, logObj);
        break;
    }
  }

  private async createBranchFromRemote(branchName: string, remoteBranchName: string) {
    let currentBranch: Reference | null = null;
    try {
      currentBranch = await this._repo.getCurrentBranch();
      logging.debug('Getting current branch', {label: 'createBranchFromRemote', branchName, currentBranch});
    } catch (e) {
      logging.warn('Can\'t load current branch', {label: 'createBranchFromRemote', branchName});
    }

    const c: Commit = await this._repo.getHeadCommit();
    logging.debug('Get head commit', {label: 'createBranchFromRemote', branchName, c});

    const branch: Reference = await this._repo.createBranch(branchName, c, false);
    logging.debug('Created branch', {label: 'createBranchFromRemote', branchName});

    await this._repo.checkoutBranch(branch);
    // Todo check if remotebranchname contains remote name

    const commit: Commit = await this._repo.getReferenceCommit(`refs/remotes/${this._remoteName}/${remoteBranchName}`);
    logging.debug('Loaded commit', {label: 'createBranchFromRemote', branchName, commit});

    await Git.Reset.reset(this._repo, commit, Reset.TYPE.HARD, {});

    logging.debug('Setting up branch to remote commit', {label: 'createBranchFromRemote', branchName});
    if (currentBranch) {
      await this._repo.checkoutBranch(currentBranch);
      logging.debug('Checking out branch', {label: 'createBranchFromRemote', branchName});
    }
  }

  private async init(): Promise<void> {
    this._repo = await Git.Repository.open(this._path);
    this._remote = await this._repo.getRemote(this._remoteName);
  }
}

export enum BranchState {
  Ahead, Behind, Equals,
}
