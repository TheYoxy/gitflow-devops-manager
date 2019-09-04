import fs from 'fs';
import Git, { Branch, FetchOptions, Remote } from 'nodegit';
import { logging } from './logging';

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

  static async create(path: string, username: string, password: string, remote = 'origin'): Promise<Repository> {
    if (!path) {
      throw new Error('Path is empty');
    }
    if (!(await fs.statSync(path)).isDirectory()) {
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
      logging.error('isLocal error', {label: 'isLocal', error: e});
      return false;
    }
  }

  async isRemote(branchName: string): Promise<boolean> {
    try {
      await this._repo.getBranch(`${this._remoteName}/${branchName}`);
      return true;
    } catch (e) {
      logging.error('isRemote error', {label: 'isRemote', error: e});
      return false;
    }
  }

  async fetch(): Promise<void> {
    await this._repo.fetch(this._remoteName, this._remoteOptions);
  }

  async getBranch(branchName: string): Promise<Branch | null> {
    try {
      return (await this._repo.getBranch(branchName)) as Branch;
    } catch (e) {
      logging.error('getBranch error', {label: 'getBranch', error: e});
      return null;
    }
  }

  async pull(branchName: string): Promise<boolean> {
    try {
      await this._remote.download([`refs/heads/${branchName}:refs/heads/${branchName}`], this._remoteOptions);
      return true;
    } catch (e) {
      logging.error('pull error', {label: 'pull', error: e});
      return false;
    }
  }

  async push(branchName: string): Promise<boolean> {
    try {
      await this._remote.push([`refs/heads/${branchName}:refs/heads/${branchName}`], this._remoteOptions);
      return true;
    } catch (e) {
      logging.error('push error', {label: 'push', error: e});
      return false;
    }
  }

  private async init(): Promise<void> {
    this._repo = await Git.Repository.open(this._path);
    this._remote = await this._repo.getRemote(this._remoteName);
  }

  async checkBranch(branchName: string): Promise<Branch | null> {
    logging.debug(`Checking if branch ${branchName} exist in local`, { branchName });
    if (await this.isLocal(branchName)) {
      logging.debug(`Branch ${branchName} exist locally`, { branchName });
      logging.debug(`Checking if branch exist in the remote ${this._remoteName}`, { remoteName: this._remoteName });
      if (await this.isRemote(branchName)) {
        logging.debug(`Branch ${branchName} exist in the remote.`, { branchName });
        logging.debug('Syncing branches');
        //todo sync method
      }
      else {
        logging.warn(`Branch ${branchName} doesn\'t exist in the remote ${this._remoteName}`, { branchName, remoteName: this._remoteName });
        logging.debug(`Pushing branch ${branchName} in the remote ${this._remoteName}`, { branchName, remoteName: this._remoteName });
        if (!await this.push(branchName)) {
          logging.crit('Push failed');
          throw new Error(`Unable to push branch ${branchName}`);
        }
        else {
          logging.info(`Branch ${branchName} has been successfully pushed on remote ${this._remoteName}`, { branchName, remoteName: this._remoteName });
          return this.getBranch(branchName);
        }
      }
    }
    else {
      logging.warn(`Branch ${branchName} doesn\'t exist locally`, { branchName });
      logging.debug(`Looking for branch in the remote ${this._remoteName}`, { branchName, remoteName: this._remoteName });
      if (await this.isRemote(branchName)) {
        logging.debug(`Branch ${branchName} exist in the remote ${this._remoteName}`, { branchName, remoteName: this._remoteName });
        logging.debug(`Pulling branch ${branchName} locally`, { branchName });
        if (!await this.pull(branchName)) {
          logging.crit(`Unable to pull branch ${branchName} from remote ${this._remoteName}`, { branchName, remoteName: this._remoteName });
          throw new Error(`Unable to pull branch ${branchName}`);
        }
        else {
          logging.debug(`Branch ${branchName} successfully pulled from remote ${this._remoteName}`, { branchName, remoteName: this._remoteName });
          return this.getBranch(branchName);
        }
      }
      else {
        logging.crit(`Unable to find branch ${branchName} in the repository`, { branchName });
        throw new Error(`Unable to find branch ${branchName} in the repository`);
      }
    }
    return null;
  }
}
