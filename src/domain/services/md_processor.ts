import { IAppContext } from '../../shared/app_context.js';

export interface IMdProcessor {
  process(ctx: IAppContext, text: string): Promise<string>;
}

export interface IMdProcessorFactory {
  getProcessor(ext: string): IMdProcessor | undefined;
}
