export interface ITranslator {
  translate(srcLangText: string, isTitleBlock: boolean): Promise<string>;
}
