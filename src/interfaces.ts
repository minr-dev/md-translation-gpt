import { Runnable } from 'langchain/schema/runnable';

export interface IMdProcessor {
  process(test: string): Promise<string>;
}

export interface IMdProcessorFactory {
  getProcessor(ext: string): IMdProcessor | undefined;
}

export interface ILlm {
  get isJsonResponse(): boolean;
  get model(): Runnable;
}

export interface ITranslator {
  translate(srcLangText: string, isTitleBlock: boolean): Promise<string>;
}
