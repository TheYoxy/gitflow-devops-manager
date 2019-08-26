import {WorkItem} from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';

export interface Type {
  name: string;
  items: WorkItem[];
}
