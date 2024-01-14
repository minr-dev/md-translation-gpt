import { BaseLanguageModelInterface } from '@langchain/core/language_models/base';
import { ChatOpenAI } from 'langchain/chat_models/openai';
import { Config } from '../../shared/config.js';
import { ILLM } from '../../domain/service/llm.js';

export class OpenAIModel implements ILLM {
  private static model: BaseLanguageModelInterface | undefined;

  getModel(): Promise<BaseLanguageModelInterface> {
    if (OpenAIModel.model) {
      return Promise.resolve(OpenAIModel.model);
    }
    const model = new ChatOpenAI({
      openAIApiKey: Config.OPENAI_API_KEY,
      modelName: 'gpt-4-1106-preview',
      temperature: 0.0,
      maxTokens: -1,
    });
    model.bind({
      response_format: {
        type: 'json_object',
      },
    });
    OpenAIModel.model = model;
    return Promise.resolve(OpenAIModel.model);
  }
}
