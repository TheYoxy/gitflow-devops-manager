import {Reference} from 'nodegit';

export interface Context {
    baseBranch: Reference;
    targetBranch: Reference;
    ids: Array<number>;
}