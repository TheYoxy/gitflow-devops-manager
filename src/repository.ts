import fs from 'fs';
import Git, { Branch, FetchOptions, Remote } from 'nodegit';

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
      return false;
    }
  }

  async isRemote(branchName: string): Promise<boolean> {
    try {
      await this._repo.getBranch(`${this._remoteName}/${branchName}`);
      return true;
    } catch (e) {
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
      return null;
    }
  }

  async pull(branchName: string): Promise<boolean> {
    try {
      await this._remote.download([`refs/heads/${branchName}:refs/heads/${branchName}`], this._remoteOptions);   
      return true;   
    } catch (e) {
      return false;
    }
  }

  async push(branchName: string): Promise<boolean> {
    try {
      await this._remote.push([`refs/heads/${branchName}:refs/heads/${branchName}`], this._remoteOptions);
      return true;      
    } catch (e) {
      return false;
    }
  }

  private async init(): Promise<void> {
    this._repo = await Git.Repository.open(this._path);
    this._remote = await this._repo.getRemote(this._remoteName);
  }
}
