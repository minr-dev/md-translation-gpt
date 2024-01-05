import { Config } from '../../../shared/config.js';
import { logger } from '../../../shared/logger.js';
import { ILLM } from '../llm.js';
import { ITranslator } from '../translator.js';
import {
  MAX_TRANSLATION_ATTEMPTS,
  TranslateCache,
  checkTranslated,
  choiceTranslation,
  translateToEn,
  translateToJp,
} from './translator_util.js';

export interface ReverseTranslated {
  en: string;
  error: string;
}

export interface TranslateChoice {
  choiceNo: number;
}

export class ReverseCheckTranslatorImpl implements ITranslator {
  constructor(private llm: ILLM) {}

  async translate(srcLangText: string, isTitleBlock: boolean): Promise<string> {
    logger.verbose('ReverseCheckTranslatorImpl.translate', srcLangText);
    for (let retryCorrectness = 0; retryCorrectness < 5; retryCorrectness++) {
      const caches: TranslateCache[] = [];
      let lastCorrectness: number | undefined = undefined;
      for (let i = 0; i < MAX_TRANSLATION_ATTEMPTS; i++) {
        logger.verbose('translation attempts count', i);
        const jpResponse = await translateToJp(
          this.llm,
          srcLangText,
          caches,
          isTitleBlock
        );
        logger.verbose('jpResponse', jpResponse);
        if (jpResponse.isJapanese) {
          return '';
        }
        const enResponse = await translateToEn(
          this.llm,
          jpResponse.ja,
          isTitleBlock
        );
        logger.verbose('enResponse', enResponse);
        const correctness = await checkTranslated(
          this.llm,
          srcLangText,
          jpResponse.ja,
          enResponse.en,
          isTitleBlock
        );
        logger.verbose('correctness', correctness);
        caches.push({
          correctness: correctness,
          japaneseTranslated: jpResponse,
        });
        if (
          correctness.correctness >= Config.TRANSLATION_CORRECTNESS_THRESHOLD
        ) {
          lastCorrectness = correctness.correctness;
          break;
        }
      }
      if (
        lastCorrectness !== undefined ||
        caches.length === MAX_TRANSLATION_ATTEMPTS
      ) {
        if (caches.length === 1) {
          return caches[0].japaneseTranslated.ja;
        }
        // 評価結果が閾値を超えている場合でも、選択肢を与えて、再度選択させる。
        // 再評価の規定回数を超えてた場合も、それまでの翻訳結果から選択させる。
        let maxCorrectness = 0;
        let maxIndex = 0;
        for (let i = 0; i < caches.length; i++) {
          if (caches[i].correctness.correctness > maxCorrectness) {
            maxCorrectness = caches[i].correctness.correctness;
            maxIndex = i;
          }
        }
        const lastChoice = await choiceTranslation(
          this.llm,
          srcLangText,
          caches,
          isTitleBlock
        );
        const sagfeIndex =
          lastChoice.choiceNo < caches.length && 0 <= lastChoice.choiceNo
            ? lastChoice.choiceNo
            : maxIndex;
        logger.verbose(
          'maxCorrectness',
          maxCorrectness,
          'maxIndex',
          maxIndex,
          'maxIndex-ja',
          caches[maxIndex].japaneseTranslated.ja,
          'lastChoice',
          lastChoice,
          'sagfeIndex',
          sagfeIndex,
          'choiced-ja',
          caches[sagfeIndex].japaneseTranslated.ja
        );
        return caches[sagfeIndex].japaneseTranslated.ja;
      }
      // MAX_TRANSLATION_ATTEMPTS に達していない場合は、なんらかのエラーが発生しているので、
      // 再度翻訳を試みる
    }
    throw new Error('failed to translate');
  }
}
