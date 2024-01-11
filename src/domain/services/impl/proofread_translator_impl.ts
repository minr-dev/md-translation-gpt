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
  targetTextWithContext: string;
  targetText: string;
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

  async translate(
    targetTextWithContext: string,
    targetText: string,
    isTitleBlock: boolean
  ): Promise<string> {
    logger.verbose('ProofreadTranslatorImpl.translate', targetText);
    for (let retryCorrectness = 0; retryCorrectness < 5; retryCorrectness++) {
      const histories: ProofreadHistory[] = [];
      let lastProofreadResult: ProofreadResult | undefined = undefined;
      const jpResponse = await translateToJp(
        this.llm,
        targetTextWithContext,
        targetText,
        [],
        isTitleBlock
      );
      let ja = jpResponse.ja;
      logger.verbose('jpResponse', jpResponse);
      if (jpResponse.isJapanese) {
        return '';
      }
      for (let i = 0; i < MAX_TRANSLATION_ATTEMPTS; i++) {
        logger.verbose('translation attempts count', i);
        const proofread = await this.proofreadTranslation({
          isTitleBlock: isTitleBlock,
          targetTextWithContext: targetTextWithContext,
          targetText: targetText,
          ja: ja,
          histories: histories,
        });
        histories.push({
          jpText: ja,
          proofreadResult: proofread,
        });
        logger.verbose('添削結果', proofread);
        if (proofread.correctness >= Config.TRANSLATION_CORRECTNESS_THRESHOLD) {
          lastProofreadResult = proofread;
          break;
        }
        ja = proofread.proofreadText;
      }
      if (lastProofreadResult !== undefined) {
        logger.info('翻訳結果', {
          original: targetText,
          japanese: lastProofreadResult.proofreadText,
          error: lastProofreadResult.error,
          correctness: lastProofreadResult.correctness,
          translationCount: histories.length,
        });
        return lastProofreadResult.proofreadText;
      }
      if (histories.length === MAX_TRANSLATION_ATTEMPTS) {
        logger.warn(`規定の翻訳回数を超えました.
original: ${targetText},
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
    const systemTemplate = `${HHH_prompt}
`;

    const humanTemplate = `<Context>
英文のテクニカルドキュメントの日本語訳を添削します。
以下は、langchainのマニュアルの一部です。全体的な文脈を把握した上で添削に取り組んでください。
"""{targetTextWithContext}
"""

<Task>
次の原文と日本語訳を比較して添削してください。

原文: """{targetText}
"""

日本語訳: """{ja}
"""

添削の手順は、次のとおり行ってください。
- 日本語訳された文章が日本語として理解可能なものになるように添削する
- 文意が正確に伝わっているか確認して訂正する
- 全体的な文脈に沿っているか確認して訂正する
- 抜けている文脈が無いか確認して訂正する
- 異なる意味になっていないか確認して訂正する
- 不自然な日本語になっている部分を訂正する
- わかりやすい平易な表現に訂正する
- 日本語から英語にリバース翻訳をして、オリジナルと同じ意味になるように訂正する

{issues}

添削時の注意点です。
- Max Marginal Relevance は、MMR（Max Marginal Relevance）と訳してください
- 機能名やクラス名などは、訳することで、ニュアンスが損なわれる場合は、英語のままにしてください
- オリジナルのテキストは、マークダウン書式です。マークダウン書式を破壊しないようにしてください
- """![xxxx](yyyyyy)""" は、マークダウンのイメージ画像なので、日本語訳不要です。
- 文中に """your secret key""" などがある場合は、訳することなくそのままにしてください。シークレットキーは探索しないでください。
{targetTextDescription}
{formatInstructionsForStringParser}
`;

    let issues = '';
    if (req.histories.length > 0) {
      issues =
        '過去に添削した指摘を、元に戻すような添削はしないでください。以下は、過去の添削結果です。\n';
      issues += req.histories.map(h => `- """${h.jpText}"""`).join('\n');
    }
    logger.verbose('issues: ', issues);

    const targetTextDescription = req.isTitleBlock
      ? '- 翻訳対象のテキストは見出しです。本文を含めて翻訳しないでください。見出しのみ翻訳してください。'
      : '';

    const stringParser = new StringOutputParser();
    // structuredParser.getFormatInstructions() を使うと英文が混ざるからか、responseのJSONが正しくないので、対処療法的だが日本語で作成する
    const formatInstructionsForStringParser = `
- 添削結果は、必ず JSON のみで返してください。JSON のプロパティは次のとおりです。
- proofreadText: 添削後の日本語訳
- correctness: 翻訳の正確性、 0.0 ～ 1.0 の数値で、最も正確な値が 1.0
- error: 添削して修正した内容の詳細
`;

    const chatPrompt = ChatPromptTemplate.fromMessages([
      ['system', systemTemplate],
      ['human', humanTemplate],
    ]);

    const variables = {
      targetTextWithContext: req.targetTextWithContext,
      targetText: req.targetText,
      ja: req.ja,
      issues: issues,
      targetTextDescription: targetTextDescription,
      formatInstructionsForStringParser: formatInstructionsForStringParser,
    };

    for (let i = 0; i < 5; i++) {
      let response;
      try {
        const chain = RunnableSequence.from([
          chatPrompt,
          await this.llm.getModel(),
          stringParser,
        ]);

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
