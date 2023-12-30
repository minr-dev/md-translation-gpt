import { Runnable } from 'langchain/schema/runnable';
import { ChatOpenAI } from 'langchain/chat_models/openai';
import { ILlm } from './core';

const JSON_RESPONSE_FORMAT = 'json_object';

export class LlmImpl implements ILlm {
  private _responseFormat: string;

  constructor() {
    this._responseFormat = JSON_RESPONSE_FORMAT;
  }

  public get isJsonResponse(): boolean {
    return this._responseFormat == JSON_RESPONSE_FORMAT;
  }

  public get model(): Runnable {
    const jsonModeModel = new ChatOpenAI({
      openAIApiKey: process.env['OPENAI_API_KEY'],
      modelName: 'gpt-4-1106-preview',
      temperature: 0.0,
      maxTokens: -1,
    });
    if (this.isJsonResponse) {
      return jsonModeModel.bind({
        response_format: {
          type: 'json_object',
        },
      });
    } else {
      return jsonModeModel;
    }
  }
}
