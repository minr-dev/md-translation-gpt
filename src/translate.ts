import {
  OutputParserException,
  StringOutputParser,
} from '@langchain/core/output_parsers';
import { RunnableSequence } from 'langchain/schema/runnable';
import { ChatPromptTemplate } from 'langchain/prompts';
import { StructuredOutputParser } from 'langchain/output_parsers';
import { logger } from './logger.js';
import { Config } from './config.js';
import { ITranslator, ILlm } from './core.js';

const MAX_TRANSLATION_ATTEMPTS = 5;

interface JapaneseTranslated {
  isJapanese: boolean;
  ja: string;
  en: string;
  error: string;
}

interface ProofreadRequest {
  isTitleBlock: boolean;
  original: string;
  ja: string;
}

interface ProofreadResult {
  proofreadText: string;
  correctness: number;
  error: string;
}

interface ReverseTranslated {
  en: string;
  error: string;
}

interface TranslateCorrectness {
  correctness: number;
  error: string;
  proofreadType: string;
}

interface TranslateChoice {
  choiceNo: number;
}

interface TranslateCache {
  correctness: TranslateCorrectness;
  japaneseTranslated: JapaneseTranslated;
}

/**
 * 翻訳する
 *
 * @param srcLangText
 * @returns
 */
export class ProofreadTranslatorImpl implements ITranslator {
  constructor(private llm: ILlm) {}

  async translate(srcLangText: string, isTitleBlock: boolean): Promise<string> {
    logger.verbose('ProofreadTranslatorImpl.translate', srcLangText);
    for (let retryCorrectness = 0; retryCorrectness < 5; retryCorrectness++) {
      const caches: TranslateCache[] = [];
      let lastProofreadResult = undefined;
      for (let i = 0; i < MAX_TRANSLATION_ATTEMPTS; i++) {
        logger.verbose('translate retry loop count', i);
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
        const proofread = await this.proofreadTranslation({
          isTitleBlock: isTitleBlock,
          original: srcLangText,
          ja: jpResponse.ja,
        });
        caches.push({
          correctness: {
            correctness: proofread.correctness,
            error: proofread.error,
            proofreadType: 'proofread',
          },
          japaneseTranslated: {
            isJapanese: false,
            ja: proofread.proofreadText,
            en: jpResponse.en,
            error: jpResponse.error,
          },
        });
        logger.verbose('proofread', proofread);
        if (proofread.correctness >= Config.translationCorrectnessThreshold) {
          lastProofreadResult = proofread;
          break;
        }
      }
      if (lastProofreadResult !== undefined) {
        logger.info('translate', {
          original: srcLangText,
          japanese: lastProofreadResult.proofreadText,
          error: lastProofreadResult.error,
          correctness: lastProofreadResult.correctness,
          translationCount: caches.length,
        });
        return lastProofreadResult.proofreadText;
      }
      if (caches.length === MAX_TRANSLATION_ATTEMPTS) {
        // 再評価の規定回数を超えてた場合、最後の添削結果を返す
        logger.warn(`translate: 再評価の規定回数を超えました.
original: ${srcLangText},
log: ${JSON.stringify(caches, null, 2)}
`);
        return caches[caches.length - 1].japaneseTranslated.ja;
      }
    }
    throw new Error('failed to translate');
  }

  private proofreadTranslation = async (
    req: ProofreadRequest
  ): Promise<ProofreadResult> => {
    logger.verbose('proofreadTranslation', req);

    const srcLangTextDescription = req.isTitleBlock
      ? '- このテキストはタイトル行に使われています'
      : '';
    const systemTemplate = `${HHH_prompt}

<Context>
翻訳前のオリジナルの文章と、翻訳結果を比較して、意味が同じになるように添削してください。
- テキストは、マークダウン書式です。
${srcLangTextDescription}

添削の手順は、オリジナルと日本語訳との比較を、次のとおり行ってください。
- 文意が正確に伝わっているか確認して訂正する
- 文脈に沿っているか確認して訂正する
- 抜けている文脈が無いか確認して訂正する
- 異なる意味になっていないか確認して訂正する
- 不自然な日本語のなっている部分を訂正する
- 日本語から英語にリバース翻訳をして、オリジナルと同じ意味になっているか確認する

{formatInstructions}
`;

    const stringParser = new StringOutputParser();
    // structuredParser.getFormatInstructions() を使うと英文が混ざるからか、responseのJSONが正しくないので、対処療法的だが日本語で作成する
    const formatInstructionsForStringParser = `
- 評価結果は、必ず JSON のみで返してください。JSON のプロパティは次のとおりです。
- correctness: 翻訳の正確性、 0.0 ～ 1.0 の数値で、最も正確な値が 1.0
- error: まだ改善した方がよい場合は、問題点を指摘してください
`;

    const humanTemplate = `
<Criteria>
オリジナル:
{original}

翻訳結果:
{ja}
`;

    const chatPrompt = ChatPromptTemplate.fromMessages([
      ['system', systemTemplate],
      ['human', humanTemplate],
    ]);

    for (let i = 0; i < 5; i++) {
      try {
        let result: ProofreadResult;
        if (this.llm.isJsonResponse) {
          const chain = RunnableSequence.from([
            chatPrompt,
            this.llm.model,
            stringParser,
          ]);
          const response = await chain.invoke({
            original: req.original,
            ja: req.ja,
            formatInstructions: formatInstructionsForStringParser,
          });
          logger.verbose('response', response);
          result = JSON.parse(response);
        } else {
          throw new Error('not implemented');
        }
        if (!result.proofreadText || result.proofreadText === '') {
          result.proofreadText = req.ja;
        }
        logger.verbose('result', result);
        return result;
      } catch (e) {
        if (e instanceof OutputParserException) {
          // OutputParserExceptionの場合の処理をここに書く
          logger.error('OutputParserException', e);
          continue;
        }
        throw e;
      }
    }
    throw new Error('failed to proofreadTranslation');
  };
}

export class ReverseCheckTranslatorImpl implements ITranslator {
  constructor(private llm: ILlm) {}

  async translate(srcLangText: string, isTitleBlock: boolean): Promise<string> {
    logger.verbose('ReverseCheckTranslatorImpl.translate', srcLangText);
    for (let retryCorrectness = 0; retryCorrectness < 5; retryCorrectness++) {
      const caches: TranslateCache[] = [];
      let lastCorrectness = undefined;
      for (let i = 0; i < MAX_TRANSLATION_ATTEMPTS; i++) {
        logger.verbose('translate retry loop count', i);
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
        if (correctness.correctness >= Config.translationCorrectnessThreshold) {
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

const HHH_prompt = `<Introduction>
あなたは、多言語のテクニカルライティングのAIアシスタントです。
AIは、親切で、丁寧で、正直で、洗練されていて、感情的で、謙虚で、でも知識が豊富であるように努めています。
アシスタントは、ほとんど何でも喜んでお手伝いしますし、何が必要かを正確に理解するために最善を尽くします。
また、誤った情報や誤解を招くような情報を与えないようにし、正しい答えが完全にわからない場合は、その旨を説明します。
とはいえ、このアシスタントは実用的で、本当にベストを尽くしてくれますし、警戒心が邪魔をするようなこともないので、安心して使えます。
`;

const translateToJp = async (
  llm: ILlm,
  srcLangText: string,
  cache: TranslateCache[],
  isTitleBlock: boolean
): Promise<JapaneseTranslated> => {
  logger.verbose('translateToJp', srcLangText);
  let error = '';
  if (cache.length > 0) {
    if (cache[0].correctness.proofreadType === 'proofread') {
      error =
        '- 日本語に翻訳したあと、再度オリジナルと日本語訳を比較して、添削を行いました。以下は、その指摘です。この指摘に対応し、且つ、以前の翻訳と同じ翻訳はしないでください。\n';
    } else if (cache[0].correctness.proofreadType === 'reverse') {
      error =
        '- 日本語に翻訳したあと、日本語から逆に英語に翻訳して、意味の一致を検証しています。以下は、以前に正しくないと判断された翻訳の指摘です。この指摘に対応し、且つ、以前の翻訳と同じ翻訳はしないでください。\n';
    } else {
      throw new Error(
        `invalid proofreadType: ${cache[0].correctness.proofreadType}`
      );
    }
    for (const prev of cache) {
      error += `    - \`${prev.japaneseTranslated.ja}\`と訳されましたが、\`${prev.correctness.error}\`と指摘されました。\n`;
    }
  }
  logger.verbose('error: ', error);
  const srcLangTextDescription = isTitleBlock
    ? '- このテキストはタイトル行に使われています'
    : '';
  const systemTemplate = `${HHH_prompt}

<Context>
langchainのマニュアルを翻訳します。以下の注意点を考慮して日本語に意訳してください。
- Max Marginal Relevance は、MMR（Max Marginal Relevance）と訳してください
- 機能名やクラス名などは、訳することで、ニュアンスが損なわれる場合は、英語のままにしてください
- オリジナルのテキストは、マークダウン書式です

${srcLangTextDescription}
{error}

翻訳の手順は、次のとおり行ってください。処理過程の解説の出力は不要です。
- オリジナルから日本語への翻訳を行う
- オリジナルが不完全な英語でも、日本語に訳してください
- 日本語訳された文章が日本語として理解可能なものにする
- 日本語から英語への逆翻訳を行う
- オリジナルと逆翻訳された英語を比較して、同じ意味になっているか確認する
{formatInstructions}
`;

  const structuredParser = StructuredOutputParser.fromNamesAndDescriptions({
    isJapanese: 'オリジナルのテキストがすでに日本語だったら true',
    ja: '日本語訳',
    en: '日本語から英語への翻訳',
    error: '翻訳が正しくできなかったときの理由',
  });
  const formatInstructions = structuredParser.getFormatInstructions();
  const stringParser = new StringOutputParser();
  // structuredParser.getFormatInstructions() を使うと英文が混ざるからか、responseのJSONが正しくないので、対処療法的だが日本語で作成する
  const formatInstructionsForStringParser = `
- 意訳した結果は、必ず JSON でのみで返してください。JSON のプロパティは次のとおりです。
- isJapanese: オリジナルのテキストがすでに日本語だったら true
- ja: 日本語訳
- en: 日本語から英語への翻訳
- error: 翻訳が正しくできなかったときの理由
`;
  const humanTemplate = `
<Criteria>
オリジナル:
{srcLangText}
`;

  const chatPrompt = ChatPromptTemplate.fromMessages([
    ['system', systemTemplate],
    ['human', humanTemplate],
  ]);

  for (let i = 0; i < 5; i++) {
    try {
      let result: JapaneseTranslated;
      if (llm.model) {
        const chain = RunnableSequence.from([
          chatPrompt,
          llm.model,
          stringParser,
        ]);
        const response = await chain.invoke({
          srcLangText: srcLangText,
          error: error,
          formatInstructions: formatInstructionsForStringParser,
        });
        logger.verbose('response', response);
        result = JSON.parse(response);
      } else {
        const chain = RunnableSequence.from([
          chatPrompt,
          llm.model,
          structuredParser,
        ]);
        const response = await chain.invoke({
          srcLangText: srcLangText,
          error: error,
          formatInstructions: formatInstructions,
        });
        result = {
          isJapanese: response.isJapanese === 'true',
          ja: response.ja,
          en: response.en,
          error: response.error,
        };
      }
      logger.verbose('result', result);
      if (!result.isJapanese && (!result.ja || result.ja === '')) {
        continue;
      }
      return result;
    } catch (e) {
      if (e instanceof OutputParserException) {
        // OutputParserExceptionの場合の処理をここに書く
        logger.error('OutputParserException', e);
        continue;
      }
      throw e;
    }
  }
  throw new Error('failed to translateToJp');
};

const translateToEn = async (
  llm: ILlm,
  jpText: string,
  isTitleBlock: boolean
): Promise<ReverseTranslated> => {
  logger.verbose('translateToEn', jpText);
  const srcLangTextDescription = isTitleBlock
    ? '- このテキストはタイトル行に使われています'
    : '';
  const systemTemplate = `${HHH_prompt}

<Context>
langchainのマニュアルを翻訳します。
日本語に意訳したものを、再度、英語に意訳してください。
${srcLangTextDescription}
- テキストは、マークダウン書式です
- 与えられた日本語が不完全でも、英語に意訳してください
- 意訳した結果は必ず JSON のみで返してください
{formatInstructions}
`;

  const structuredParser = StructuredOutputParser.fromNamesAndDescriptions({
    en: '英語訳',
    error: '翻訳が正しくできなかったときの理由',
  });
  const formatInstructions = structuredParser.getFormatInstructions();
  const stringParser = new StringOutputParser();
  // structuredParser.getFormatInstructions() を使うと英文が混ざるからか、responseのJSONが正しくないので、対処療法的だが日本語で作成する
  const formatInstructionsForStringParser = `
- en: 英語訳
- error: 翻訳が正しくできなかったときの理由
`;
  const humanTemplate = `
<Criteria>
日本語:
{jpText}
`;

  const chatPrompt = ChatPromptTemplate.fromMessages([
    ['system', systemTemplate],
    ['human', humanTemplate],
  ]);

  const chain = RunnableSequence.from([
    chatPrompt,
    llm.model,
    structuredParser,
  ]);

  for (let i = 0; i < 5; i++) {
    try {
      let result: ReverseTranslated;
      if (llm.isJsonResponse) {
        const chain = RunnableSequence.from([
          chatPrompt,
          llm.model,
          stringParser,
        ]);
        const response = await chain.invoke({
          jpText: jpText,
          formatInstructions: formatInstructionsForStringParser,
        });
        logger.verbose('response', response);
        result = JSON.parse(response);
      } else {
        const response = await chain.invoke({
          jpText: jpText,
          formatInstructions: formatInstructions,
        });

        logger.verbose('response', response);
        if (response.en === '') {
          continue;
        }
        result = {
          en: response.en,
          error: response.error,
        };
      }
      logger.verbose('result', result);
      if (!result.en || result.en === '') {
        continue;
      }
      return result;
    } catch (e) {
      if (e instanceof OutputParserException) {
        // OutputParserExceptionの場合の処理をここに書く
        logger.error('OutputParserException', e);
        continue;
      }
      throw e;
    }
  }
  throw new Error('failed to translateToEn');
};

const checkTranslated = async (
  llm: ILlm,
  srcLangText: string,
  jpText: string,
  enText: string,
  isTitleBlock: boolean
): Promise<TranslateCorrectness> => {
  logger.verbose('checkTranslated', srcLangText, jpText, enText);

  const srcLangTextDescription = isTitleBlock
    ? '- このテキストはタイトル行に使われています'
    : '';
  const systemTemplate = `${HHH_prompt}

<Context>
langchainのマニュアルを翻訳結果を評価します。
翻訳前のオリジナルの文章と、オリジナルから日本語への翻訳文、
その日本語訳をさらに英語に逆翻訳した文章を提示します。
オリジナルと逆翻訳の文章を比較して、同じ意味になっているか確認してください。
テキストは、マークダウン書式です。
${srcLangTextDescription}

{formatInstructions}
`;

  const structuredParser = StructuredOutputParser.fromNamesAndDescriptions({
    correctness: '0.0 ～ 1.0 の数値で、最も正確な値が 1.0',
    error: '翻訳が正しくない場合は、その理由',
  });
  const formatInstructions = structuredParser.getFormatInstructions();
  const stringParser = new StringOutputParser();
  // structuredParser.getFormatInstructions() を使うと英文が混ざるからか、responseのJSONが正しくないので、対処療法的だが日本語で作成する
  const formatInstructionsForStringParser = `
- 評価結果は、必ず JSON のみで返してください。JSON のプロパティは次のとおりです。
- correctness: 0.0 ～ 1.0 の数値で、最も正確な値が 1.0
- error: 翻訳が正しくない場合は、その理由
`;

  const humanTemplate = `
<Criteria>
オリジナル:
{srcLangText}

日本語:
{jpText}

英語:
{enText}
`;

  const chatPrompt = ChatPromptTemplate.fromMessages([
    ['system', systemTemplate],
    ['human', humanTemplate],
  ]);

  const chain = RunnableSequence.from([
    chatPrompt,
    llm.model,
    structuredParser,
  ]);

  for (let i = 0; i < 5; i++) {
    try {
      let result: TranslateCorrectness;
      if (llm.isJsonResponse) {
        const chain = RunnableSequence.from([
          chatPrompt,
          llm.model,
          stringParser,
        ]);
        const response = await chain.invoke({
          srcLangText: srcLangText,
          jpText: jpText,
          enText: enText,
          formatInstructions: formatInstructionsForStringParser,
        });
        logger.verbose('response', response);
        result = JSON.parse(response);
      } else {
        const response = await chain.invoke({
          srcLangText: srcLangText,
          jpText: jpText,
          enText: enText,
          formatInstructions: formatInstructions,
        });

        logger.verbose('response', response);
        result = {
          correctness: parseFloat(response.correctness),
          error: response.error,
          proofreadType: 'reverse',
        };
      }
      logger.verbose('result', result);
      return result;
    } catch (e) {
      if (e instanceof OutputParserException) {
        // OutputParserExceptionの場合の処理をここに書く
        logger.error('OutputParserException', e);
        continue;
      }
      throw e;
    }
  }
  throw new Error('failed to check translated');
};

const choiceTranslation = async (
  llm: ILlm,
  srcLangText: string,
  cache: TranslateCache[],
  isTitleBlock: boolean
): Promise<TranslateChoice> => {
  logger.verbose('choiceTranslation', cache, isTitleBlock);

  const srcLangTextDescription = isTitleBlock
    ? '- このテキストはタイトル行に使われています'
    : '';
  const systemTemplate = `${HHH_prompt}

<Context>
翻訳前のオリジナルの文章と、翻訳結果を比較して、最も適した意訳分を選択してください。
テキストは、マークダウン書式です。
${srcLangTextDescription}

{formatInstructions}
`;

  const structuredParser = StructuredOutputParser.fromNamesAndDescriptions({
    choiceNo: `選択した訳文のNoを 0 ～ ${cache.length - 1} でセット`,
  });
  const formatInstructions = structuredParser.getFormatInstructions();
  const stringParser = new StringOutputParser();
  // structuredParser.getFormatInstructions() を使うと英文が混ざるからか、responseのJSONが正しくないので、対処療法的だが日本語で作成する
  const formatInstructionsForStringParser = `
- 評価結果は、必ず JSON のみで返してください。JSON のプロパティは次のとおりです。
- choiceNo: 選択した訳文を 0 ～ ${cache.length - 1} でセット
`;

  const list = cache
    .map((c, i) => {
      `- No.${i}: ${c.japaneseTranslated.ja}`;
    })
    .join('\n');
  const humanTemplate = `
<Criteria>
オリジナル:
{srcLangText}

翻訳結果:
${list}
`;

  const chatPrompt = ChatPromptTemplate.fromMessages([
    ['system', systemTemplate],
    ['human', humanTemplate],
  ]);

  const chain = RunnableSequence.from([
    chatPrompt,
    llm.model,
    structuredParser,
  ]);

  for (let i = 0; i < 5; i++) {
    try {
      let result: TranslateChoice;
      if (llm.isJsonResponse) {
        const chain = RunnableSequence.from([
          chatPrompt,
          llm.model,
          stringParser,
        ]);
        const response = await chain.invoke({
          srcLangText: srcLangText,
          formatInstructions: formatInstructionsForStringParser,
        });
        logger.verbose('response', response);
        result = JSON.parse(response);
      } else {
        const response = await chain.invoke({
          srcLangText: srcLangText,
          formatInstructions: formatInstructions,
        });

        logger.verbose('response', response);
        result = {
          choiceNo: parseInt(response.choiceNo),
        };
      }
      logger.verbose('result', result);
      return result;
    } catch (e) {
      if (e instanceof OutputParserException) {
        // OutputParserExceptionの場合の処理をここに書く
        logger.error('OutputParserException', e);
        continue;
      }
      throw e;
    }
  }
  throw new Error('failed to choiceTranslation');
};
