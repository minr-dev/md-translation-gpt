import {
  ChatPromptTemplate,
  SystemMessagePromptTemplate,
  HumanMessagePromptTemplate,
} from '@langchain/core/prompts';
import {
  INTRODUCTION_TEMPLATE,
  TRANSLATION_NOTES_TEMPLATE,
  makeTargetTextDescription,
} from './etoj_prompts.js';
import { logger } from '../../../shared/logger.js';
import { AppContext } from '../../../shared/app_context.js';

export interface ProofreadInput {
  isTitleBlock: boolean;
  targetTextWithContext: string;
  targetText: string;
  ja: string;
  histories: ProofreadOutput[];
}

export interface ProofreadOutput {
  proofreadText: string;
  correctness: number;
  error?: string;
}

const contextTemplate = `<Context>
英文のテクニカルドキュメントの日本語訳を添削します。
以下は、「{documentName}」の一部です。全体的な文脈を把握した上で添削に取り組んでください。
"""{targetTextWithContext}
"""
`;

const systemTemplate = `${INTRODUCTION_TEMPLATE}
----------------
${contextTemplate}
`;

const taskTemplate = `<Task>
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
${TRANSLATION_NOTES_TEMPLATE.trim()}
{targetTextDescription}
{formatInstructionsForStringParser}
`;

// structuredParser.getFormatInstructions() を使うと英文が混ざるからか、responseのJSONが正しくないので、対処療法的だが日本語で作成する
const formatInstructionsForStringParser = `
- 添削結果は、必ず JSON のみで返してください。JSON のプロパティは次のとおりです。
- proofreadText: 添削後の日本語訳
- correctness: 翻訳の正確性、 0.0 ～ 1.0 の数値で、最も正確な値が 1.0
- error: 添削して修正した内容の詳細
`;

const makeIssues = (): string => {
  const proofreadInput = AppContext.getCurrent().get(
    'proofreadInput'
  ) as ProofreadInput;
  if (!proofreadInput) {
    throw new Error('proofreadInput is not set');
  }
  let issues = '';
  if (proofreadInput.histories.length > 1) {
    issues =
      '過去にも添削していますが、同じ指摘を繰り返したり、添削前に戻したりしないようにしてください。過去の添削結果です。\n';
    let h = proofreadInput.histories[0];
    issues += `* 初回の日本語訳: """${h.proofreadText}"""\n`;
    for (let i = 1; i < proofreadInput.histories.length; i++) {
      h = proofreadInput.histories[i];
      issues += `* ${i}回目の添削:\n  添削結果: """${h.proofreadText}"""\n  指摘コメント: """${h.error}"""\n`;
    }
  }
  logger.verbose('issues', issues);
  return issues;
};

const messages = [
  SystemMessagePromptTemplate.fromTemplate(systemTemplate),
  HumanMessagePromptTemplate.fromTemplate(taskTemplate),
];

const baseTemplate = ChatPromptTemplate.fromMessages<ProofreadInput>(messages);

export const DEFAULT_PROOFREAD_PROMPT = baseTemplate.partial({
  issues: makeIssues,
  targetTextDescription: makeTargetTextDescription,
  formatInstructionsForStringParser: formatInstructionsForStringParser.trim(),
});
