import { AppContext } from '../../shared/app_context.js';

export interface IMdProcessor {
  process(ctx: AppContext, text: string): Promise<string>;
}

export interface IMdProcessorFactory {
  getProcessor(ext: string): IMdProcessor | undefined;
}
