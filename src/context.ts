import {WorkItem} from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import {Reference} from 'nodegit';

export interface Context {
  baseBranch: Reference;
  targetBranch: Reference;
  ids: number[];
  workItems: WorkItem[];
}
