import {
  ChatPromptTemplate,
  SystemMessagePromptTemplate,
  HumanMessagePromptTemplate,
} from '@langchain/core/prompts';
import { AppContext } from '../../../shared/app_context.js';

export interface EtojInput {
  targetTextWithContext: string;
  targetText: string;
  isTitleBlock: boolean;
}

export interface EtojOutput {
  isJapanese: boolean;
  ja: string;
  error: string;
}

export const INTRODUCTION_TEMPLATE = `<Introduction>
あなたは、システム開発に精通する多言語のテクニカルライターのAIアシスタントです。
AIは、親切で、丁寧で、正直で、洗練されていて、感情的で、謙虚で、でも知識が豊富であるように努めています。
アシスタントは、ほとんど何でも喜んでお手伝いしますし、何が必要かを正確に理解するために最善を尽くします。
また、誤った情報や誤解を招くような情報を与えないようにし、正しい答えが完全にわからない場合は、その旨を説明します。
とはいえ、このアシスタントは実用的で、本当にベストを尽くしてくれますし、警戒心が邪魔をするようなこともないので、安心して使えます。
`;

const contextTemplate = `----------------
<Context>
英文のテクニカルドキュメントを日本語に意訳します。
以下は、langchainのマニュアルの一部です。全体的な文脈を把握した上で翻訳に取り組んでください。
"""{targetTextWithContext}
"""
`;

const systemTemplate = `${INTRODUCTION_TEMPLATE}
${contextTemplate}
`;

export const TRANSLATION_NOTES_TEMPLATE = `
- Max Marginal Relevance は、MMR（Max Marginal Relevance）と訳してください
- 機能名やクラス名などは、訳することで、ニュアンスが損なわれる場合は、英語のままにしてください
- オリジナルのテキストは、マークダウン書式です。マークダウン書式を破壊しないようにしてください
- """![xxxx](yyyyyy)""" は、マークダウンのイメージ画像なので、日本語訳不要です。
- 文中に """your secret key""" などがある場合は、訳することなくそのままにしてください。シークレットキーは探索しないでください。
`;

const taskTemplate = `----------------
<Task>
次の部分を日本語に意訳してください。
"""{targetText}
"""

翻訳の手順は、次のとおり行ってください。
- オリジナルから日本語への翻訳を行う
- オリジナルが不完全な英文でも、日本語に訳してください
- 日本語訳された文章が日本語として理解可能なものにする
- 日本語から英語への逆翻訳を行う
- オリジナルと逆翻訳された英語を比較して、同じ意味になっているか確認する

翻訳時の注意点です。
${TRANSLATION_NOTES_TEMPLATE.trim()}
{targetTextDescription}
{formatInstructionsForStringParser}
`;

export const makeTargetTextDescription = (): string => {
  const etojInput = AppContext.getCurrent().get('etojInput') as EtojInput;
  if (!etojInput) {
    throw new Error('etojInput is not set');
  }
  return etojInput.isTitleBlock
    ? '- 翻訳対象のテキストは見出しです。本文を含めて翻訳しないでください。見出しのみ翻訳してください。'
    : '';
};

// structuredParser.getFormatInstructions() を使うと英文が混ざるからか、responseのJSONが正しくないので、対処療法的だが日本語で作成する
const formatInstructionsForStringParser = `
- 意訳した結果は、必ず JSON でのみで返してください。JSON のプロパティは次のとおりです。
- isJapanese: オリジナルのテキストがすでに日本語だったら true
- ja: 日本語訳
- error: 翻訳が正しくできなかったときの理由
`;

const messages = [
  SystemMessagePromptTemplate.fromTemplate(systemTemplate),
  HumanMessagePromptTemplate.fromTemplate(taskTemplate),
];

const baseTemplate = ChatPromptTemplate.fromMessages(messages);

export const DEFAULT_ETOJ_PROMPT = baseTemplate.partial({
  targetTextDescription: makeTargetTextDescription,
  formatInstructionsForStringParser: formatInstructionsForStringParser.trim(),
});
