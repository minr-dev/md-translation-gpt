import { Runnable } from 'langchain/schema/runnable';

export interface IMdProcessor {
  process(file: string): Promise<string>;
}

export interface ILlm {
  get isJsonResponse(): boolean;
  get model(): Runnable;
}

export interface ITranslator {
  translate(srcLangText: string, isTitleBlock: boolean): Promise<string>;
}
