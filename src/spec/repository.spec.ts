import {Repository} from '../repository';
import fs from 'fs';
import 'jest';
import trash from 'trash';
import Git from 'nodegit';
import * as os from "os";
import * as path from "path";

let folder!: string;
const username = 'TheYoxy';
const password = '6b589f0f00e03ae2a67d0d3389082d225087bb86';

beforeAll(async (): Promise<void> => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'gdm-'), "utf8");
  const r = await Git.Clone.clone('https://github.com/TheYoxy/gdm-test.git', folder, {
    fetchOpts: {
      callbacks: {
        credentials() {
          return Git.Cred.userpassPlaintextNew(username, password);
        },
      },
    }
  });
});

afterAll(async (): Promise<void> => {
  await trash(folder);
});

describe('Git folder', () => {
  it('should exist', () => {
    expect(fs.statSync(folder).isDirectory()).toBe(true);
  });
});

describe('Repository', () => {
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
      })
    });

    describe('is local', () => {
      it('should be true on a valid local branch', () => {
        return expect(repo.isLocal(branchName)).resolves.toBe(true);
      });

      it('should be false on an invalid branch', () => {
        return expect(repo.isLocal(invalidBranchName)).resolves.toBe(false);
      });
    });

  });

  it('should build', () => {
    return expect(Repository.create(folder, '', '')).resolves.toBeInstanceOf(Repository);
  });

  it('should not build', () => {
    return expect(Repository.create('', '', '')).rejects.toThrow('Path is empty');
  });
});