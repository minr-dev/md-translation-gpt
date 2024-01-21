import { BaseLanguageModelInterface } from '@langchain/core/language_models/base';

export interface ILLM {
  getModel(): Promise<BaseLanguageModelInterface>;
}
