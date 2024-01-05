import { Runnable } from 'langchain/schema/runnable';
import { ChatOpenAI } from 'langchain/chat_models/openai';
import { Config } from '../../shared/config.js';
import { ILLM } from '../../domain/services/llm.js';

export class OpenAIModel implements ILLM {
  private static model: Runnable | undefined;

  getModel(): Promise<Runnable> {
    if (OpenAIModel.model) {
      return Promise.resolve(OpenAIModel.model);
    }
    const model = new ChatOpenAI({
      openAIApiKey: Config.OPENAI_API_KEY,
      modelName: 'gpt-4-1106-preview',
      temperature: 0.0,
      maxTokens: -1,
    });
    const jsonModeModel = model.bind({
      response_format: {
        type: 'json_object',
      },
    });
    OpenAIModel.model = jsonModeModel;
    return Promise.resolve(OpenAIModel.model);
  }
}
