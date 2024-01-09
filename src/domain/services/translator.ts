export interface ITranslator {
  translate(
    targetTextWithContext: string,
    targetText: string,
    isTitleBlock: boolean
  ): Promise<string>;
}
