import { AppContext } from '../../shared/app_context.js';

export interface ITranslator<TIN, TOUT> {
  translate(ctx: AppContext, input: TIN): Promise<TOUT>;
}
