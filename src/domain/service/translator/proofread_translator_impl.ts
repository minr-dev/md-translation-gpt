import { JsonOutputParser } from '@langchain/core/output_parsers';
import { logger } from '../../../shared/logger.js';
import { Config } from '../../../shared/config.js';
import { ITranslator } from '../translator.js';
import { ILLM } from '../llm.js';
import { AppContext } from '../../../shared/app_context.js';
import { MAX_LLM_RETRY_ATTEMPTS, MAX_PROOFREAD_ATTEMPTS } from './constants.js';
import { EtojInput, EtojOutput, DEFAULT_ETOJ_PROMPT } from './etoj_prompts.js';
import {
  ProofreadInput,
  ProofreadOutput,
  DEFAULT_PROOFREAD_PROMPT,
} from './proofread_prompts.js';

export class ProofreadTranslatorImpl implements ITranslator<EtojInput, string> {
  constructor(private llm: ILLM) {}

  async translate(ctx: AppContext, etojInput: EtojInput): Promise<string> {
    logger.verbose(
      'ProofreadTranslatorImpl.translate: ',
      etojInput.targetText,
      etojInput.isTitleBlock
    );

    const model = await this.llm.getModel();

    ctx.set('etojInput', etojInput);

    const etojPrompt = await DEFAULT_ETOJ_PROMPT;
    const proofreadPrompt = await DEFAULT_PROOFREAD_PROMPT;

    const etojOutput = (await etojPrompt
      .pipe(model)
      .pipe(new JsonOutputParser())
      .withRetry({ stopAfterAttempt: MAX_LLM_RETRY_ATTEMPTS })
      .invoke(etojInput)) as EtojOutput;
    logger.verbose('etojOutput', etojOutput);

    const proofreadChain = proofreadPrompt
      .pipe(model)
      .pipe(new JsonOutputParser())
      .withRetry({ stopAfterAttempt: MAX_LLM_RETRY_ATTEMPTS });

    const proofreadInput: ProofreadInput = {
      ...etojInput,
      ...etojOutput,
      histories: [
        { proofreadText: etojOutput.ja, correctness: 0.0, error: '' },
      ],
    };
    let answer = '';
    for (let i = 0; i < MAX_PROOFREAD_ATTEMPTS; i++) {
      logger.verbose('proofread attempts count', i);
      ctx.set('proofreadInput', proofreadInput);
      const proofreadOutput = (await proofreadChain.invoke(
        proofreadInput
      )) as ProofreadOutput;
      logger.verbose('proofreadOutput', proofreadOutput);
      answer = proofreadOutput.proofreadText;
      if (
        proofreadOutput.correctness >= Config.TRANSLATION_CORRECTNESS_THRESHOLD
      ) {
        break;
      }
      proofreadInput.histories.push(proofreadOutput);
    }

    logger.verbose('result', {
      originalText: etojInput.targetText,
      translationResult: answer,
      numberOfProofreads: proofreadInput.histories.length,
    });
    return answer;
  }
}
