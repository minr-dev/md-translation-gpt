import { Runnable } from 'langchain/schema/runnable';

export interface ILLM {
  getModel(): Promise<Runnable>;
}
