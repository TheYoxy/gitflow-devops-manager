import config from 'config';
import fs from 'fs';
import 'jest';
import Git from 'nodegit';
import * as os from 'os';
import * as path from 'path';
import tmp from 'tmp';
import {BranchState, Repository} from '../repository';

let r!: Git.Repository;
let folder!: string;
const username = config.get<string>('Credentials.Username');
const password = config.get<string>('Credentials.Token');

beforeAll(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'gdm-'), 'utf8');
});

describe('Git folder', () => {
  it('should exist', () => {
    console.log(folder);
    expect(fs.statSync(folder).isDirectory()).toBe(true);
  });
});

describe('Repository', () => {
  beforeAll(async (): Promise<void> => {
    r = await Git.Clone.clone('https://github.com/TheYoxy/gdm-test.git', folder, {
      fetchOpts: {
        callbacks: {
          credentials() {
            return Git.Cred.userpassPlaintextNew(username, password);
          },
        },
      },
    });
    await r.setHead('refs/remotes/origin/master');
  });

  describe('when created', () => {
    const branchName = 'master';
    const invalidBranchName = 'A bad branch name';

    let repo!: Repository;
    beforeAll(async (): Promise<void> => {
      repo = await Repository.create(folder, username, password);
    });

    it('should be able to fetch the remote', () => {
      return expect(repo.fetch()).resolves.toBeUndefined();
    });

    describe('get branch', () => {
      it('should be able to get master branch', () => {
        return expect(repo.getBranch(branchName)).resolves.toBeTruthy();
      });

      it('should be null when getting a bad branch', () => {
        return expect(repo.getBranch(invalidBranchName)).resolves.toBeNull();
      });
    });

    describe('is local', () => {
      it('should be true on a valid local branch', () => {
        return expect(repo.isLocal(branchName)).resolves.toBe(true);
      });

      it('should be false on an invalid branch', () => {
        return expect(repo.isLocal(invalidBranchName)).resolves.toBe(false);
      });
    });

    describe('is remote', () => {
      it('should be true on a valid remote branch', () => {
        return expect(repo.isRemote(branchName)).resolves.toBe(true);
      });

      it('should be false on an invalid branch', () => {
        return expect(repo.isRemote(invalidBranchName)).resolves.toBe(false);
      });
    });

    describe('Pull branch', () => {
      it('should pull the remote branch', () => {
        return expect(repo.pull(branchName)).resolves.toBe(true);
      });

      it('should not pull the invalid remote branch', () => {
        return expect(repo.pull(invalidBranchName)).resolves.toBe(false);
      });

      it.each(['develop', 'release', 'master'])
      ('should pull %s and have the branch locally',
       async (branchName: string) => {
         await expect(repo.pull(branchName)).resolves.toBe(true);
         await expect(repo.isLocal(branchName)).resolves.toBe(true);
       });
    });

    describe('Push branch', () => {
      it('should push the remote branch', () => {
        return expect(repo.push(branchName)).resolves.toBe(true);
      });

      it('should not push the invalid remote branch', () => {
        return expect(repo.push(`${branchName}/${invalidBranchName}`)).resolves.toBe(false);
      });
    });

    describe('.compareBranch', () => {
      const oldBranch = 'master';
      const newBranch = 'develop';
      const equalOldBranch = 'release';

      beforeAll(async () => {
        // tslint:disable-next-line:forin
        for (const branch in [oldBranch, newBranch, equalOldBranch]) {
          await repo.fetch();
          await repo.pull(branch);
        }
      });

      it.each([oldBranch, newBranch, equalOldBranch])('branch %s should exist', (branchName: string) => {
        return expect(repo.isLocal(branchName)).resolves.toBe(true);
      });

      it(`${newBranch} should be ahead of ${oldBranch}`, () => {
        return expect(repo.compareBranch(newBranch, oldBranch)).resolves.toBe(BranchState.Ahead);
      });

      it(`${oldBranch} should be behind ${newBranch}`, () => {
        return expect(repo.compareBranch(oldBranch, newBranch)).resolves.toBe(BranchState.Behind);
      });

      it(`${oldBranch} shoud be equals as ${equalOldBranch}`, () => {
        return expect(repo.compareBranch(oldBranch, equalOldBranch)).resolves.toBe(BranchState.Equals);
      });
    });
  });

  it('should build', () => {
    return expect(Repository.create(folder, '', '')).resolves.toBeInstanceOf(Repository);
  });

  it('should not build on empty directory', () => {
    return expect(Repository.create('', '', '')).rejects.toThrow('Path is empty');
  });

  it('should not build on non directory', () => {
    const name = tmp.fileSync({keep: false}).name;
    return expect(Repository.create(name, '', '')).rejects.toThrow('Path doesn\'t exist');
  });
});
