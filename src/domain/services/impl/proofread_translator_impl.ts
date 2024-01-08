import { ChatPromptTemplate } from 'langchain/prompts';
import { RunnableSequence } from '@langchain/core/runnables';
import {
  OutputParserException,
  StringOutputParser,
} from '@langchain/core/output_parsers';
import { Config } from '../../../shared/config.js';
import { logger } from '../../../shared/logger.js';
import { ITranslator } from '../translator.js';
import { ILLM } from '../llm.js';
import {
  HHH_prompt,
  MAX_TRANSLATION_ATTEMPTS,
  dprintPrompt,
  translateToJp,
} from './translator_util.js';

interface ProofreadRequest {
  isTitleBlock: boolean;
  original: string;
  ja: string;
  histories: ProofreadHistory[];
}

interface ProofreadResult {
  proofreadText: string;
  correctness: number;
  error: string;
}

interface ProofreadHistory {
  jpText: string;
  proofreadResult: ProofreadResult;
}

export class ProofreadTranslatorImpl implements ITranslator {
  constructor(private llm: ILLM) {}

  async translate(srcLangText: string, isTitleBlock: boolean): Promise<string> {
    logger.verbose('ProofreadTranslatorImpl.translate', srcLangText);
    for (let retryCorrectness = 0; retryCorrectness < 5; retryCorrectness++) {
      const histories: ProofreadHistory[] = [];
      let lastProofreadResult: ProofreadResult | undefined = undefined;
      const jpResponse = await translateToJp(
        this.llm,
        srcLangText,
        [],
        isTitleBlock
      );
      let jpText = jpResponse.ja;
      logger.verbose('jpResponse', jpResponse);
      if (jpResponse.isJapanese) {
        return '';
      }
      for (let i = 0; i < MAX_TRANSLATION_ATTEMPTS; i++) {
        logger.verbose('translation attempts count', i);
        const proofread = await this.proofreadTranslation({
          isTitleBlock: isTitleBlock,
          original: srcLangText,
          ja: jpText,
          histories: histories,
        });
        histories.push({
          jpText: jpText,
          proofreadResult: proofread,
        });
        logger.verbose('添削結果', proofread);
        if (proofread.correctness >= Config.TRANSLATION_CORRECTNESS_THRESHOLD) {
          lastProofreadResult = proofread;
          break;
        }
        jpText = proofread.proofreadText;
      }
      if (lastProofreadResult !== undefined) {
        logger.info('翻訳結果', {
          original: srcLangText,
          japanese: lastProofreadResult.proofreadText,
          error: lastProofreadResult.error,
          correctness: lastProofreadResult.correctness,
          translationCount: histories.length,
        });
        return lastProofreadResult.proofreadText;
      }
      if (histories.length === MAX_TRANSLATION_ATTEMPTS) {
        logger.warn(`規定の翻訳回数を超えました.
original: ${srcLangText},
history: ${JSON.stringify(histories, null, 2)}
`);
        return histories[histories.length - 1].proofreadResult.proofreadText;
      }
    }
    throw new Error('failed to translate');
  }

  private proofreadTranslation = async (
    req: ProofreadRequest
  ): Promise<ProofreadResult> => {
    const srcLangTextDescription = req.isTitleBlock
      ? '- このテキストはタイトル行に使われています'
      : '';
    const systemTemplate = `${HHH_prompt}

<Context>
翻訳前のオリジナルの文章と、日本語訳を比較して、意味が同じになるように添削してください。
- テキストは、マークダウン書式です。
- \`![xxxx](yyyyyy)\` は、マークダウンのイメージ画像なので、日本語訳不要です。
- 文中に "your secret key" などがある場合は、訳することなくそのままにしてください。シークレットキーは探索しないでください。
${srcLangTextDescription}

添削の手順は、オリジナルと日本語訳との比較を、次のとおり行ってください。
- 文意が正確に伝わっているか確認して訂正する
- 文脈に沿っているか確認して訂正する
- 抜けている文脈が無いか確認して訂正する
- 異なる意味になっていないか確認して訂正する
- 不自然な日本語になっている部分を訂正する
- 日本語から英語にリバース翻訳をして、オリジナルと同じ意味になっているか確認する
- 添削後の日本語訳は、過去に問題指摘した訳であってはならない

{formatInstructions}
`;

    const stringParser = new StringOutputParser();
    // structuredParser.getFormatInstructions() を使うと英文が混ざるからか、responseのJSONが正しくないので、対処療法的だが日本語で作成する
    const formatInstructionsForStringParser = `
- 評価結果は、必ず JSON のみで返してください。JSON のプロパティは次のとおりです。
- proofreadText: 添削後の日本語訳
- correctness: 翻訳の正確性、 0.0 ～ 1.0 の数値で、最も正確な値が 1.0
- error: 添削して修正した内容の詳細
`;

    const humanTemplate = `
<Criteria>
オリジナル:
<en>
{original}
</en>

日本語訳:
<ja>
{ja}
</ja>

{jaHistories}
`;

    let jaHistories = '';
    if (req.histories.length > 0) {
      jaHistories = '過去に問題指摘した訳:\n';
      jaHistories += req.histories
        .map(h => `- <ja>${h.jpText}</ja>`)
        .join('\n');
    }

    const chatPrompt = ChatPromptTemplate.fromMessages([
      ['system', systemTemplate],
      ['human', humanTemplate],
    ]);

    for (let i = 0; i < 5; i++) {
      let response;
      try {
        const chain = RunnableSequence.from([
          chatPrompt,
          await this.llm.getModel(),
          stringParser,
        ]);
        const variables = {
          original: req.original,
          ja: req.ja,
          formatInstructions: formatInstructionsForStringParser,
          jaHistories: jaHistories,
        };
        dprintPrompt(
          [
            ['system', systemTemplate],
            ['human', humanTemplate],
          ],
          variables
        );
        response = await chain.invoke(variables);
        const result = JSON.parse(response) as ProofreadResult;
        return result;
      } catch (e) {
        if (e instanceof OutputParserException) {
          logger.error('OutputParserException', e);
          continue;
        }
        if (e instanceof SyntaxError) {
          logger.error('SyntaxError', e, response);
          continue;
        }
        if (e instanceof Error && e.name === 'TimeoutError') {
          logger.error('TimeoutError', e);
          continue;
        }
        throw e;
      }
    }
    throw new Error('failed to proofreadTranslation');
  };
}
