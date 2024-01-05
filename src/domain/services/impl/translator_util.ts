import {
  OutputParserException,
  StringOutputParser,
} from '@langchain/core/output_parsers';
import { RunnableSequence } from '@langchain/core/runnables';
import { ChatPromptTemplate } from 'langchain/prompts';
import { logger } from '../../../shared/logger.js';
import { ILLM } from '../llm.js';
import {
  ReverseTranslated,
  TranslateChoice,
} from './reverse_check_translator_impl.js';

export const MAX_TRANSLATION_ATTEMPTS = 5;

export interface JapaneseTranslated {
  isJapanese: boolean;
  ja: string;
  error: string;
}

export interface TranslateCorrectness {
  correctness: number;
  error: string;
  proofreadType: string;
}

export interface TranslateCache {
  correctness: TranslateCorrectness;
  japaneseTranslated: JapaneseTranslated;
}

export const HHH_prompt = `<Introduction>
あなたは、多言語のテクニカルライティングのAIアシスタントです。
AIは、親切で、丁寧で、正直で、洗練されていて、感情的で、謙虚で、でも知識が豊富であるように努めています。
アシスタントは、ほとんど何でも喜んでお手伝いしますし、何が必要かを正確に理解するために最善を尽くします。
また、誤った情報や誤解を招くような情報を与えないようにし、正しい答えが完全にわからない場合は、その旨を説明します。
とはいえ、このアシスタントは実用的で、本当にベストを尽くしてくれますし、警戒心が邪魔をするようなこともないので、安心して使えます。
`;

export const translateToJp = async (
  llm: ILLM,
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

  const stringParser = new StringOutputParser();
  // structuredParser.getFormatInstructions() を使うと英文が混ざるからか、responseのJSONが正しくないので、対処療法的だが日本語で作成する
  const formatInstructionsForStringParser = `
- 意訳した結果は、必ず JSON でのみで返してください。JSON のプロパティは次のとおりです。
- isJapanese: オリジナルのテキストがすでに日本語だったら true
- ja: 日本語訳
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
      const chain = RunnableSequence.from([
        chatPrompt,
        await llm.getModel(),
        stringParser,
      ]);
      const variables = {
        srcLangText: srcLangText,
        error: error,
        formatInstructions: formatInstructionsForStringParser,
      };
      dprintPrompt(
        [
          ['system', systemTemplate],
          ['human', humanTemplate],
        ],
        variables
      );
      const response = await chain.invoke(variables);
      const result = JSON.parse(response) as JapaneseTranslated;
      if (!result.isJapanese && (!result.ja || result.ja === '')) {
        continue;
      }
      return result;
    } catch (e) {
      if (e instanceof OutputParserException) {
        logger.error('OutputParserException', e);
        continue;
      }
      if (e instanceof SyntaxError) {
        logger.error('SyntaxError', e);
        continue;
      }
      throw e;
    }
  }
  throw new Error('failed to translateToJp');
};

export const translateToEn = async (
  llm: ILLM,
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

  const stringParser = new StringOutputParser();
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
    await llm.getModel(),
    stringParser,
  ]);

  for (let i = 0; i < 5; i++) {
    try {
      const response = await chain.invoke({
        jpText: jpText,
        formatInstructions: formatInstructionsForStringParser,
      });
      const result = JSON.parse(response) as ReverseTranslated;
      if (!result.en || result.en === '') {
        continue;
      }
      return result;
    } catch (e) {
      if (e instanceof OutputParserException) {
        logger.error('OutputParserException', e);
        continue;
      }
      throw e;
    }
  }
  throw new Error('failed to translateToEn');
};

export const checkTranslated = async (
  llm: ILLM,
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
    await llm.getModel(),
    stringParser,
  ]);

  for (let i = 0; i < 5; i++) {
    try {
      const response = await chain.invoke({
        srcLangText: srcLangText,
        jpText: jpText,
        enText: enText,
        formatInstructions: formatInstructionsForStringParser,
      });
      const result = JSON.parse(response) as TranslateCorrectness;
      return result;
    } catch (e) {
      if (e instanceof OutputParserException) {
        logger.error('OutputParserException', e);
        continue;
      }
      throw e;
    }
  }
  throw new Error('failed to check translated');
};

export const choiceTranslation = async (
  llm: ILLM,
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
    await llm.getModel(),
    stringParser,
  ]);

  for (let i = 0; i < 5; i++) {
    try {
      const response = await chain.invoke({
        srcLangText: srcLangText,
        formatInstructions: formatInstructionsForStringParser,
      });
      const result: TranslateChoice = JSON.parse(response);
      return result;
    } catch (e) {
      if (e instanceof OutputParserException) {
        logger.error('OutputParserException', e);
        continue;
      }
      throw e;
    }
  }
  throw new Error('failed to choiceTranslation');
};

export const dprintPrompt = (
  templates: string[][],
  variables: { [key: string]: string | number }
): void => {
  const format = (
    template: string,
    variables: { [key: string]: string | number }
  ): string => {
    let result = template;
    for (const key in variables) {
      result = result.replace(`{${key}}`, variables[key].toString());
    }
    return result;
  };
  let debug = '';
  for (const t of templates) {
    debug += `${t[0]}:\n`;
    debug += format(t[1], variables);
    debug += '\n';
  }
  logger.debug(debug);
};
