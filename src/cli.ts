import dotenv from 'dotenv';
dotenv.config();

import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'fs';
import { glob } from 'glob';
import path, { join } from 'path';
import { remark } from 'remark';
import { fileURLToPath } from 'url';
import { Parent, Blockquote, RootContent } from 'mdast';
import fs from 'fs';
import frontmatter from 'remark-frontmatter';
import stringify from 'remark-stringify';
import { ChatPromptTemplate } from 'langchain/prompts';
import { StructuredOutputParser } from 'langchain/output_parsers';
import { Runnable, RunnableSequence } from 'langchain/schema/runnable';
import {
  OutputParserException,
  StringOutputParser,
} from '@langchain/core/output_parsers';
import { ChatOpenAI } from '@langchain/openai';

const moduleDir = fileURLToPath(new URL('.', import.meta.url));

const packageJsonPath = join(moduleDir, '../package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
const version: string = packageJson.version;

const processor = remark().use(frontmatter, ['yaml']).use(stringify);

enum LogLevel {
  OFF = 0,
  ERROR = 1,
  WARN = 2,
  INFO = 3,
  VERBOSE = 4,
  DEBUG = 5,
}

const JSON_RESPONSE_FORMAT = true;
const MAX_TRANSLATION_ATTEMPTS = 5;
let translationCorrectnessThreshold = 0.9;
let isOverwrite = false;
let logLevel = LogLevel.INFO;

class Logger {
  constructor() {}

  info(...messages: any[]) {
    if (logLevel >= LogLevel.INFO) {
      console.info(`INFO: ${new Date().toISOString()} -`, ...messages);
    }
  }

  debug(...messages: any[]) {
    if (logLevel >= LogLevel.DEBUG) {
      console.debug(`DEBUG: ${new Date().toISOString()} -`, ...messages);
    }
  }

  verbose(...messages: any[]) {
    if (logLevel >= LogLevel.VERBOSE) {
      console.log(`VERBOSE: ${new Date().toISOString()} -`, ...messages);
    }
  }

  warn(...messages: any[]) {
    if (logLevel >= LogLevel.WARN) {
      console.warn(`WARN: ${new Date().toISOString()} -`, ...messages);
    }
  }

  error(...messages: any[]) {
    if (logLevel >= LogLevel.ERROR) {
      console.error(`ERROR: ${new Date().toISOString()} -`, ...messages);
    }
  }
}

let logger = new Logger();

const createLlm = (): Runnable => {
  const jsonModeModel = new ChatOpenAI({
    openAIApiKey: process.env['OPENAI_API_KEY'],
    modelName: 'gpt-4-1106-preview',
    temperature: 0.0,
    maxTokens: -1,
  });
  if (JSON_RESPONSE_FORMAT) {
    return jsonModeModel.bind({
      response_format: {
        type: 'json_object',
      },
    });
  } else {
    return jsonModeModel;
  }
};

interface TranslatedJa {
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

interface TranslatedEn {
  en: string;
  error: string;
}

interface TranslateCorrectness {
  correctness: number;
  ngCause: string;
  proofreadType: string;
}

interface TranslateChoice {
  choiceNo: number;
}

interface TranslateCache {
  correctness: TranslateCorrectness;
  translatedJa: TranslatedJa;
}

/**
 * 翻訳する
 *
 * @param srcLangText
 * @returns
 */
const translate = async (
  srcLangText: string,
  isTitleBlock: boolean
): Promise<string> => {
  logger.verbose('translate', srcLangText);
  for (let retryCorrectness = 0; retryCorrectness < 5; retryCorrectness++) {
    const caches: TranslateCache[] = [];
    let lastProofreadResult = undefined;
    for (let i = 0; i < MAX_TRANSLATION_ATTEMPTS; i++) {
      logger.verbose('translate retry loop count', i);
      const jpResponse = await translateToJp(srcLangText, caches, isTitleBlock);
      logger.verbose('jpResponse', jpResponse);
      if (jpResponse.isJapanese) {
        return '';
      }
      const proofread = await proofreadTranslation({
        isTitleBlock: isTitleBlock,
        original: srcLangText,
        ja: jpResponse.ja,
      });
      logger.verbose('proofread', proofread);
      if (proofread.correctness >= translationCorrectnessThreshold) {
        lastProofreadResult = proofread;
        break;
      }
      caches.push({
        correctness: {
          correctness: proofread.correctness,
          ngCause: proofread.error,
          proofreadType: 'proofread',
        },
        translatedJa: {
          isJapanese: false,
          ja: proofread.proofreadText,
          en: jpResponse.en,
          error: jpResponse.error,
        },
      });
    }
    if (lastProofreadResult !== undefined) {
      logger.info('translate', {
        original: srcLangText,
        proofread: lastProofreadResult,
      });
      return lastProofreadResult.proofreadText;
    }
    if (caches.length === MAX_TRANSLATION_ATTEMPTS) {
      // 再評価の規定回数を超えてた場合、最後の添削結果を返す
      logger.warn(`translate: 再評価の規定回数を超えました.
srcLangText: ${srcLangText},
log: ${JSON.stringify(caches, null, 2)}
`);
      return caches[caches.length - 1].translatedJa.ja;
    }
  }
  throw new Error('failed to translate');
};

const translate2 = async (
  srcLangText: string,
  isTitleBlock: boolean
): Promise<string> => {
  logger.verbose('translate', srcLangText);
  for (let retryCorrectness = 0; retryCorrectness < 5; retryCorrectness++) {
    const caches: TranslateCache[] = [];
    let lastCorrectness = undefined;
    for (let i = 0; i < MAX_TRANSLATION_ATTEMPTS; i++) {
      logger.verbose('translate retry loop count', i);
      const jpResponse = await translateToJp(srcLangText, caches, isTitleBlock);
      logger.verbose('jpResponse', jpResponse);
      if (jpResponse.isJapanese) {
        return '';
      }
      const enResponse = await translateToEn(jpResponse.ja, isTitleBlock);
      logger.verbose('enResponse', enResponse);
      const correctness = await checkTranslated(
        srcLangText,
        jpResponse.ja,
        enResponse.en,
        isTitleBlock
      );
      logger.verbose('correctness', correctness);
      caches.push({
        correctness: correctness,
        translatedJa: jpResponse,
      });
      if (correctness.correctness >= translationCorrectnessThreshold) {
        lastCorrectness = correctness.correctness;
        break;
      }
    }
    if (
      lastCorrectness !== undefined ||
      caches.length === MAX_TRANSLATION_ATTEMPTS
    ) {
      if (caches.length === 1) {
        return caches[0].translatedJa.ja;
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
        caches[maxIndex].translatedJa.ja,
        'lastChoice',
        lastChoice,
        'sagfeIndex',
        sagfeIndex,
        'choiced-ja',
        caches[sagfeIndex].translatedJa.ja
      );
      return caches[sagfeIndex].translatedJa.ja;
    }
    // MAX_TRANSLATION_ATTEMPTS に達していない場合は、なんらかのエラーが発生しているので、
    // 再度翻訳を試みる
  }
  throw new Error('failed to translate');
};

const HHH_prompt = `<Introduction>
あなたは、多言語のテクニカルライティングのAIアシスタントです。
AIは、親切で、丁寧で、正直で、洗練されていて、感情的で、謙虚で、でも知識が豊富であるように努めています。
アシスタントは、ほとんど何でも喜んでお手伝いしますし、何が必要かを正確に理解するために最善を尽くします。
また、誤った情報や誤解を招くような情報を与えないようにし、正しい答えが完全にわからない場合は、その旨を説明します。
とはいえ、このアシスタントは実用的で、本当にベストを尽くしてくれますし、警戒心が邪魔をするようなこともないので、安心して使えます。
`;

const translateToJp = async (
  srcLangText: string,
  cache: TranslateCache[],
  isTitleBlock: boolean
): Promise<TranslatedJa> => {
  logger.verbose('translateToJp', srcLangText);
  const llm = createLlm();
  let ngCause = '';
  if (cache.length > 0) {
    if (cache[0].correctness.proofreadType === 'proofread') {
      ngCause =
        '- 日本語に翻訳したあと、再度オリジナルと日本語訳を比較して、添削を行いました。以下は、その指摘です。この指摘に対応し、且つ、以前の翻訳と同じ翻訳はしないでください。\n';
    } else if (cache[0].correctness.proofreadType === 'reverse') {
      ngCause =
        '- 日本語に翻訳したあと、日本語から逆に英語に翻訳して、意味の一致を検証しています。以下は、以前に正しくないと判断された翻訳の指摘です。この指摘に対応し、且つ、以前の翻訳と同じ翻訳はしないでください。\n';
    } else {
      throw new Error(
        `invalid proofreadType: ${cache[0].correctness.proofreadType}`
      );
    }
    for (const prev of cache) {
      ngCause += `    - \`${prev.translatedJa.ja}\`と訳されましたが、\`${prev.correctness.ngCause}\`と指摘されました。\n`;
    }
  }
  logger.verbose('ngCause', ngCause);
  const srcLangTextDescription = isTitleBlock
    ? '- このテキストはタイトル行に使われています'
    : '';
  const systemTemplate = `${HHH_prompt}

<Context>
langchainのマニュアルを翻訳します。以下の注意点を考慮して日本語に意訳してください。
- Max Marginal Relevance は、MMR（Max Marginal Relevance）と訳してください
- オリジナルのテキストは、マークダウン書式です

${srcLangTextDescription}
{ngCause}

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
      let result: TranslatedJa;
      if (JSON_RESPONSE_FORMAT) {
        const chain = RunnableSequence.from([chatPrompt, llm, stringParser]);
        const response = await chain.invoke({
          srcLangText: srcLangText,
          ngCause: ngCause,
          formatInstructions: formatInstructionsForStringParser,
        });
        logger.verbose('response', response);
        result = JSON.parse(response);
      } else {
        let chain = RunnableSequence.from([chatPrompt, llm, structuredParser]);
        const response = await chain.invoke({
          srcLangText: srcLangText,
          ngCause: ngCause,
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
  jpText: string,
  isTitleBlock: boolean
): Promise<TranslatedEn> => {
  logger.verbose('translateToEn', jpText);
  const llm = createLlm();
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

  const chain = RunnableSequence.from([chatPrompt, llm, structuredParser]);

  for (let i = 0; i < 5; i++) {
    try {
      let result: TranslatedEn;
      if (JSON_RESPONSE_FORMAT) {
        const chain = RunnableSequence.from([chatPrompt, llm, stringParser]);
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
  srcLangText: string,
  jpText: string,
  enText: string,
  isTitleBlock: boolean
): Promise<TranslateCorrectness> => {
  logger.verbose('checkTranslated', srcLangText, jpText, enText);
  const llm = createLlm();

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
    ngCause: '翻訳が正しくない場合は、その理由',
  });
  const formatInstructions = structuredParser.getFormatInstructions();
  const stringParser = new StringOutputParser();
  // structuredParser.getFormatInstructions() を使うと英文が混ざるからか、responseのJSONが正しくないので、対処療法的だが日本語で作成する
  const formatInstructionsForStringParser = `
- 評価結果は、必ず JSON のみで返してください。JSON のプロパティは次のとおりです。
- correctness: 0.0 ～ 1.0 の数値で、最も正確な値が 1.0
- ngCause: 翻訳が正しくない場合は、その理由
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

  const chain = RunnableSequence.from([chatPrompt, llm, structuredParser]);

  for (let i = 0; i < 5; i++) {
    try {
      let result: TranslateCorrectness;
      if (JSON_RESPONSE_FORMAT) {
        const chain = RunnableSequence.from([chatPrompt, llm, stringParser]);
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
          ngCause: response.ngCause,
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
  srcLangText: string,
  cache: TranslateCache[],
  isTitleBlock: boolean
): Promise<TranslateChoice> => {
  logger.verbose('choiceTranslation', cache, isTitleBlock);
  const llm = createLlm();

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
      `- No.${i}: ${c.translatedJa.ja}`;
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

  const chain = RunnableSequence.from([chatPrompt, llm, structuredParser]);

  for (let i = 0; i < 5; i++) {
    try {
      let result: TranslateChoice;
      if (JSON_RESPONSE_FORMAT) {
        const chain = RunnableSequence.from([chatPrompt, llm, stringParser]);
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

const proofreadTranslation = async (
  req: ProofreadRequest
): Promise<ProofreadResult> => {
  logger.verbose('proofreadTranslation', req);
  const llm = createLlm();

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
      if (JSON_RESPONSE_FORMAT) {
        const chain = RunnableSequence.from([chatPrompt, llm, stringParser]);
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

const translateHeadings = async (srcText: string): Promise<string> => {
  logger.verbose('translateHeadings', srcText);
  srcText = srcText.trim();
  const text = srcText.replace(/^#+/g, '');
  const dstText = await translate(text, true);
  if (dstText === '') {
    return srcText;
  } else {
    return `${srcText} | ${dstText}`;
  }
};

const translateParagraph = async (srcText: string): Promise<string> => {
  logger.verbose('translateParagraph', srcText);
  const dstText = await translate(srcText, false);
  logger.verbose('dstText', `-${dstText}-`);
  if (dstText === '') {
    return srcText;
  } else if (dstText === srcText) {
    return srcText;
  } else {
    return dstText;
  }
};

interface ITranslateNode {
  node: Parent;
  parent: Parent;
  srcText: string;
  replaceNodes?: RootContent[];
}

const visitWithDepth = (
  tree: Parent,
  callback: (node: Parent, parent: Parent | null, depth: number) => void
) => {
  visitDepth(tree, null, callback, 0);
};

const visitDepth = (
  node: Parent,
  parent: Parent | null,
  callback: (node: Parent, parent: Parent | null, depth: number) => void,
  depth: number
) => {
  callback(node, parent, depth);

  if (node.children) {
    for (let child of node.children) {
      visitDepth(child as Parent, node, callback, depth + 1);
    }
  }
};

/**
 * md と mdx を処理する
 *
 *
 * @param file ファイル名
 * @returns 翻訳後の md
 */
const processMd = async (file: string): Promise<string> => {
  logger.verbose('processMd', file);
  const isMdx = path.extname(file).toLowerCase() === '.mdx';
  // md ファイルを読み込んで、remark で AST に変換する
  const md = readFileSync(file, 'utf-8');
  const ast = processor.parse(md);
  // AST を走査して headings と paragraph のノードを翻訳
  // visit が async に対応していないので、一旦 tnodes の配列に入れてから処理する
  logger.debug('ast', JSON.stringify(ast, null, 2));
  const tnodes: ITranslateNode[] = [];
  visitWithDepth(ast, (node, parent, depth) => {
    if (!('type' in node)) {
      return;
    }
    if (node.type === 'heading' || node.type === 'paragraph') {
      if (!parent) {
        // heading や paragraph の上位層には root が必ずあるので parent が null の状態はない
        throw new Error(`parent is null: ${JSON.stringify(node)}`);
      }
      const srcText = processor.stringify(node as any);
      // mdx で @theme から始まる import 文は翻訳しない
      if (
        isMdx &&
        srcText.match(/^\s*import\s+DocCardList\s+from\s+["']@theme/)
      ) {
        return;
      }
      tnodes.push({
        node: node,
        parent: parent,
        srcText: srcText,
      });
    }
  });
  for (const tnode of tnodes) {
    if (tnode.node.type === 'heading') {
      const translated = await translateHeadings(tnode.srcText);
      const root = processor.parse(translated);
      logger.debug('heading translated', JSON.stringify(root, null, 2));
      tnode.replaceNodes = root.children;
    } else if (tnode.node.type === 'paragraph') {
      const translated = await translateParagraph(tnode.srcText);
      if (translated != tnode.srcText) {
        const root = processor.parse(translated);
        logger.debug('paragraph translated', JSON.stringify(root, null, 2));
        tnode.replaceNodes = root.children.concat([
          {
            type: 'blockquote',
            children: [tnode.node],
          } as Blockquote,
        ]);
      }
    } else {
      throw new Error(`unknown node type: ${JSON.stringify(tnode.node)}`);
    }
  }
  logger.debug('tnodes', JSON.stringify(tnodes, null, 2));
  // ASTを再帰的に探索し、各ノードがtnodes配列内のノードと一致するかどうかを確認し、
  // 一致するノードが見つかった場合、そのノードを新しいノードで置き換えます。
  // 新しいノードは、tnodes配列内の対応するノードのdstTextプロパティから生成します。
  for (const tnode of tnodes) {
    for (let i = 0; i < tnode.parent.children.length; i++) {
      if (tnode.parent.children[i] !== tnode.node) {
        continue;
      }
      if (tnode.replaceNodes) {
        // ノードが一致するものが見つかったところで置き換え（削除して差し込み）
        tnode.parent.children.splice(i, 1, ...tnode.replaceNodes);
      }
      break;
    }
  }
  logger.debug('ast', JSON.stringify(ast, null, 2));
  const result = processor.stringify(ast as any);
  return result;
};

/**
 * ipynb を処理する
 *
 * @param file ファイル名
 * @returns 翻訳後の md
 */
const processIpynb = async (file: string): Promise<string> => {
  // ここにファイルを処理するコードを書く
  // logger.verbose(file);
  return '';
};

/**
 * 翻訳結果をファイルに書き込む
 *
 * 翻訳後のファイルがあれば、元のファイルを .bk でバックアップする
 * すでに .bk がある場合は、上書きしない
 *
 * @param file ファイル名
 * @param text 翻訳結果
 */
const writeTranslatedMd = async (file: string, text: string): Promise<void> => {
  logger.verbose('writeTranslatedMd', text);
  if (fs.existsSync(file)) {
    const backupFile = file + '.bk';
    fs.renameSync(file, backupFile);
  }
  // ディレクトリがない場合は作成する
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  writeFileSync(file, text);
};

/**
 * glob の pattern から起点のディレクトリを求める
 *
 * ワイルドカード（* や ? など）が使われている場合、その1つ上のディレクトリを起点として、
 * ワイルドカードがない場合は、ファイルのあるディレクトリを起点とする
 *
 * @param pattern
 * @returns 起点のディレクトリ
 */
const getBaseDir = (pattern: string): string => {
  if (glob.hasMagic(pattern)) {
    const sep = path.sep.replace(/\\/g, '\\\\');
    const baseDir = pattern.replace(new RegExp(`${sep}\\*\\*.*$`), '');
    return baseDir;
  } else {
    return path.dirname(pattern);
  }
};

/**
 * inputFilePath と同じディレクトリ構成で、出力先ディレクトリ配下のパスを求める
 *
 * @param inputFilePath 入力ファイルのパス
 * @param baseDir 入力ファイルの起点となるディレクトリ
 * @param outputDir 出力先ディレクトリ
 * @returns
 */
const getOutputFilePath = (
  inputFilePath: string,
  baseDir: string,
  outputDir: string
): string => {
  const relativePath = path.relative(baseDir, inputFilePath);
  const outputFilePath = path.join(outputDir, relativePath);
  return outputFilePath;
};

/**
 * glob パターンに一致するファイルを取得して処理する
 *
 * ファイルは、 md, mdx, ipynb のみ処理する
 *
 * @param pattern glob パターン
 * @param output 出力先ディレクトリ
 */
const processFiles = async (pattern: string, output: string): Promise<void> => {
  logger.verbose('pattern', pattern);
  const files = glob.globSync(pattern);
  const baseDir = getBaseDir(pattern);
  for (const file of files) {
    // 拡張子を取得して、処理するファイルかどうかを判定する
    const ext = path.extname(file).toLowerCase();
    const outputFilePath = getOutputFilePath(file, baseDir, output);
    if (!['.md', '.mdx', '.ipynb'].includes(ext)) {
      logger.info(`${file} skipped`);
      continue;
    }
    if (fs.existsSync(outputFilePath)) {
      if (!isOverwrite) {
        logger.info(`${outputFilePath} exists`);
        continue;
      }
    }
    logger.info(`${file} ...`);
    let result = undefined;
    if ('.md' === ext || '.mdx' === ext) {
      result = await processMd(file);
    } else if ('.ipynb' === ext) {
      result = await processIpynb(file);
    } else {
      throw new Error(`invalid ext: ${ext}`);
    }
    writeTranslatedMd(outputFilePath, result);
    logger.info(`${file} writed to ${outputFilePath}`);
  }
};

const program = new Command();

(async (): Promise<void> => {
  program
    .version(version)
    .name('md-translation-gpt')
    .option('-d, --debug', 'enables verbose logging', false)
    .requiredOption('-p, --pattern <pattern>', 'glob pattern to process files')
    .requiredOption('-o, --output <output>', 'output directory')
    .option('-f, --force', 'overwrite existing files', false)
    .option(
      '-a, --accuracy <number>',
      'set translation accuracy threshold',
      value => {
        const parsedValue = parseFloat(value);
        if (isNaN(parsedValue) || parsedValue < 0 || parsedValue > 1) {
          throw new Error('Accuracy must be a number between 0 and 1');
        }
        return parsedValue;
      },
      0.9
    )
    .action(async (request: any): Promise<void> => {
      try {
        if (request.debug) {
          logLevel = LogLevel.VERBOSE;
        }

        translationCorrectnessThreshold = request.accuracy;
        isOverwrite = request.force;
        await processFiles(request.pattern, request.output);
        logger.info('success');
      } catch (e) {
        let debug = true;
        if (request.debug !== undefined) {
          debug = request.debug;
        }
        const eany = e as any;
        if (e instanceof Error) {
          if (debug) {
            logger.error(e.stack);
          } else {
            logger.error(e.message);
          }
        } else if (eany['statusCode']) {
          logger.error('Error');
          logger.error(`statusCode: ${eany['statusCode']}`);
          logger.error(`statusMessage: ${eany['statusMessage']}`);
          logger.error(`body: ${eany['body']}`);
        } else {
          logger.error(e);
        }
      }
    });

  await program.parseAsync(process.argv);
})();
