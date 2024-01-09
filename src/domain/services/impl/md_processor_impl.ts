import { remark } from 'remark';
import { Parent, Blockquote, RootContent } from 'mdast';
import frontmatter from 'remark-frontmatter';
import stringify from 'remark-stringify';
import { Root } from 'remark-parse/lib/index.js';
import { createByModelName, TikTokenizer } from '@microsoft/tiktokenizer';

import { logger } from '../../../shared/logger.js';
import { IMdProcessor } from '../md_processor.js';
import { ITranslator } from '../translator.js';
import { IAppContext } from '../../../shared/app_context.js';
import { MdDoc, MdDocId } from '../../md_doc.js';
import { IMdDocRepository } from '../../repository/md_doc_repository.js';

let tokenizer: TikTokenizer | undefined = undefined;

const countToken = async (text: string): Promise<number> => {
  if (!tokenizer) {
    tokenizer = await createByModelName('gpt-3.5-turbo');
  }
  const tokens = tokenizer.encode(text);
  return tokens.length;
};

export interface IParseResult {
  md: string;
  ast: Root;
  tnodes: ITargetNode[];
}

export interface ITargetNode {
  node: Parent;
  parent: Parent;
  targetTextWithContext: string;
  targetText: string;
  replaceNodes?: RootContent[];
  type: 'text' | ':::';
}

const visitWithParent = async (
  tree: Parent,
  callback: (node: Parent, parent: Parent | null) => Promise<void>
) => {
  await visitParent(tree, null, callback);
};

const visitParent = async (
  node: Parent,
  parent: Parent | null,
  callback: (node: Parent, parent: Parent | null) => Promise<void>
) => {
  await callback(node, parent);

  if (node.children) {
    for (const child of node.children) {
      await visitParent(child as Parent, node, callback);
    }
  }
};

/**
 * md を翻訳する
 *
 * md は ast に変換して、ast の child node のうち、heading と paragraph について
 * 翻訳処理して、翻訳後のテキストで node を作り直して、ast を書き換えて md に戻す。
 *
 * @param file ファイル名
 * @returns 翻訳後の md
 */
export class MdProcessorImpl implements IMdProcessor {
  protected processor = remark().use(frontmatter, ['yaml']).use(stringify);

  constructor(
    protected translator: ITranslator,
    protected mdDocRepository: IMdDocRepository
  ) {}

  async process(ctx: IAppContext, data: string): Promise<string> {
    logger.verbose('MdProcessor.process');
    const result = await this.parseMd(data);
    await this.translateNodes(ctx, result);
    const tranlatedMd = await this.recreateAst(result);
    return tranlatedMd;
  }

  /**
   * md を ast に変換して、翻訳対象の heading と paragraph の node を抽出する
   *
   * 翻訳は、対象のnodeをchild node を含めて、テキストに戻したものを翻訳するので、
   * 例えば、paragraph を構成する child node は、テキストだけではなく、 link があったり、
   * list、blockquote などの細かく分かれるが、翻訳する時点では、paragraph の node 配下を
   * テキストに変換して、まとめて翻訳する。
   *
   * @param md
   */
  protected async parseMd(md: string): Promise<IParseResult> {
    const ast = this.processor.parse(md);
    logger.debug('ast', JSON.stringify(ast, null, 2));
    const tnodes: ITargetNode[] = [];
    await visitWithParent(ast, async (node, parent) => {
      if (!('type' in node)) {
        return;
      }
      if (node.type === 'heading' || node.type === 'paragraph') {
        if (!parent) {
          // heading や paragraph の上位層には root が必ずあるので parent が null の状態はない
          throw new Error(`parent is null: ${JSON.stringify(node)}`);
        }
        if (!node.position) {
          // 手づくりでnodeを使ったのではなくて、mdをparseした結果のnodeなので、positionはあるはず
          throw new Error(`node.position is null: ${JSON.stringify(node)}`);
        }
        const targetText = this.processor.stringify(node as Root);
        const targetTextWithContext = await this.makeTargetTextWithContext(
          md,
          node
        );
        tnodes.push({
          node: node,
          parent: parent,
          targetTextWithContext: targetTextWithContext,
          targetText: targetText,
          type: 'text',
        });
      }
    });
    return {
      md: md,
      ast: ast,
      tnodes: tnodes,
    };
  }

  protected async makeTargetTextWithContext(
    md: string,
    node: Parent
  ): Promise<string> {
    if (
      !node.position ||
      node.position.start.offset === undefined ||
      node.position.end.offset === undefined
    ) {
      // 手づくりでnodeを使ったのではなくて、mdをparseした結果のnodeなので、positionはあるはず
      throw new Error(`node.position is null: ${JSON.stringify(node)}`);
    }
    const MAX_TOKENS = 500;
    const MIN_APPEND_TOKENS = MAX_TOKENS / 5;
    let start = node.position.start.offset;
    let end = node.position.end.offset;
    const eot = md.length;
    let targetTextWithContext = md.substring(start, end);
    let tokens = await countToken(md.substring(start, end));
    while (tokens < MAX_TOKENS) {
      if (start === 0 && end === eot) {
        break;
      }
      let append = Math.floor((MAX_TOKENS - tokens) / 2);
      if (append < MIN_APPEND_TOKENS) {
        append = MIN_APPEND_TOKENS;
      }
      if (start > 0) {
        start -= append;
        if (start < 0) {
          start = 0;
        }
      }
      if (end < eot) {
        end += append;
        if (end > eot) {
          end = eot;
        }
      }
      targetTextWithContext = md.substring(start, end);
      tokens = await countToken(targetTextWithContext);
    }
    return targetTextWithContext;
  }

  /**
   * 処理対象のノードを翻訳して、翻訳後のノードを tnodes に入れる
   *
   * @param ctx
   * @param result
   * @returns
   */
  protected async translateNodes(
    ctx: IAppContext,
    result: IParseResult
  ): Promise<void> {
    for (const tnode of result.tnodes) {
      if (tnode.type !== 'text') {
        continue;
      }
      // イメージのリンクはイメージのバイナリデータが含まれていることがあるので、予め除外する
      if (tnode.targetText.match(/^[!]\[.*?\]\(.*?\)/)) {
        tnode.type = ':::';
        continue;
      }
      if (tnode.node.type === 'heading') {
        const translated = await this.translateHeadings(tnode);
        const mdDoc = new MdDoc(
          new MdDocId(ctx.file, ctx.nodeNo),
          tnode.node.type,
          tnode.targetText,
          translated
        );
        await this.mdDocRepository.save(mdDoc);
        const root = this.processor.parse(translated);
        logger.debug('heading translated', JSON.stringify(root, null, 2));
        tnode.replaceNodes = root.children;
      } else if (tnode.node.type === 'paragraph') {
        const translated = await this.translateParagraph(tnode);
        const mdDoc = new MdDoc(
          new MdDocId(ctx.file, ctx.nodeNo),
          tnode.node.type,
          tnode.targetText,
          translated
        );
        await this.mdDocRepository.save(mdDoc);
        if (translated != tnode.targetText) {
          const root = this.processor.parse(translated);
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
    logger.debug('tnodes', JSON.stringify(result.tnodes, null, 2));
  }

  /**
   * 翻訳後の node で ast を作り直す
   *
   * tnodeには、対象nodeとそのnodeの親要素(parent)も保存してあるので、ASTの全部のnodeを再帰的に比較しなくても、
   * parentのchildrenを一階層のみ探せば見つかる。
   * 一致するnodeが見つかったら、そのnodeを翻訳結果で作成された tnode.replaceNodes で置き換える。
   *
   * @param result
   * @returns
   */
  protected async recreateAst(result: IParseResult): Promise<string> {
    for (const tnode of result.tnodes) {
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
    logger.debug('ast', JSON.stringify(result.ast, null, 2));
    const md = this.processor.stringify(result.ast);
    return Promise.resolve(md);
  }

  protected async translateHeadings(tnode: ITargetNode): Promise<string> {
    const srcText = tnode.targetText.trim();
    const text = srcText.replace(/^#+\s*/g, '');
    const dstText = await this.translator.translate(
      tnode.targetTextWithContext,
      text,
      true
    );
    if (dstText === '' || srcText === dstText) {
      return srcText;
    } else {
      return `${srcText} | ${dstText}`;
    }
  }

  protected async translateParagraph(tnode: ITargetNode): Promise<string> {
    const dstText = await this.translator.translate(
      tnode.targetTextWithContext,
      tnode.targetText,
      false
    );
    if (dstText === '') {
      return tnode.targetText;
    } else if (dstText === tnode.targetText) {
      return tnode.targetText;
    } else {
      return dstText;
    }
  }
}
