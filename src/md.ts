import path from 'path';
import { readFileSync } from 'fs';
import { remark } from 'remark';
import { Parent, Blockquote, RootContent } from 'mdast';
import frontmatter from 'remark-frontmatter';
import stringify from 'remark-stringify';
import { logger } from './logger.js';
import { IMdProcessor, ITranslator } from './core.js';
import { Root } from 'remark-parse/lib/index.js';

const processor = remark().use(frontmatter, ['yaml']).use(stringify);

interface ITargetNode {
  node: Parent;
  parent: Parent;
  srcText: string;
  replaceNodes?: RootContent[];
}

const visitWithParent = (
  tree: Parent,
  callback: (node: Parent, parent: Parent | null) => void
) => {
  visitParent(tree, null, callback);
};

const visitParent = (
  node: Parent,
  parent: Parent | null,
  callback: (node: Parent, parent: Parent | null) => void
) => {
  callback(node, parent);

  if (node.children) {
    for (const child of node.children) {
      visitParent(child as Parent, node, callback);
    }
  }
};

/**
 * md と mdx を処理する
 *
 * @param file ファイル名
 * @returns 翻訳後の md
 */
export class MdProcessorImpl implements IMdProcessor {
  constructor(private translator: ITranslator) {}

  async process(file: string): Promise<string> {
    logger.verbose('MdProcessor.process', file);
    const isMdx = path.extname(file).toLowerCase() === '.mdx';
    const md = readFileSync(file, 'utf-8');
    const result = await this.parseMd(md, isMdx);
    return result;
  }

  protected async parseMd(md: string, isMdx: boolean): Promise<string> {
    const ast = processor.parse(md);
    // 翻訳結果のデータでmdのノードを作って、 AST の配列を削除して新しいノードを差し込んだりするが、
    // visit パターンの処理途中で削除するとバグになり易いので、3段階に分けて処理を行う
    // step1: 処理対象のノードを、いったん tnodes に入れる
    logger.debug('ast', JSON.stringify(ast, null, 2));
    const tnodes: ITargetNode[] = [];
    visitWithParent(ast, (node, parent) => {
      if (!('type' in node)) {
        return;
      }
      if (node.type === 'heading' || node.type === 'paragraph') {
        if (!parent) {
          // heading や paragraph の上位層には root が必ずあるので parent が null の状態はない
          throw new Error(`parent is null: ${JSON.stringify(node)}`);
        }
        const srcText = processor.stringify(node as Root);
        // mdx で @theme/*** の import 文は翻訳しない
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
    // step2: 処理対象のノードを翻訳して、翻訳後のノードを tnodes に入れる
    for (const tnode of tnodes) {
      if (tnode.node.type === 'heading') {
        const translated = await this.translateHeadings(tnode.srcText);
        const root = processor.parse(translated);
        logger.debug('heading translated', JSON.stringify(root, null, 2));
        tnode.replaceNodes = root.children;
      } else if (tnode.node.type === 'paragraph') {
        const translated = await this.translateParagraph(tnode.srcText);
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
    // step3: 翻訳後のノードで AST を加工する
    // tnodeには、対象nodeとそのnodeの親要素(parent)も保存してあるので、ASTの全部のnode再帰的に比較しなくても、
    // parentのchildrenを一階層のみ探せば見つかる。
    // 一致するnodeが見つかったら、そのnodeを翻訳結果で作成された tnode.replaceNodes で置き換える。
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
    const result = processor.stringify(ast);
    return result;
  }

  protected async translateHeadings(srcText: string): Promise<string> {
    logger.verbose('translateHeadings', srcText);
    srcText = srcText.trim();
    const text = srcText.replace(/^#+/g, '');
    const dstText = await this.translator.translate(text, true);
    if (dstText === '') {
      return srcText;
    } else {
      return `${srcText} | ${dstText}`;
    }
  }

  protected async translateParagraph(srcText: string): Promise<string> {
    logger.verbose('translateParagraph', srcText);
    const dstText = await this.translator.translate(srcText, false);
    if (dstText === '') {
      return srcText;
    } else if (dstText === srcText) {
      return srcText;
    } else {
      return dstText;
    }
  }
}

/**
 * ipynb を処理する
 *
 * @param file ファイル名
 * @returns 翻訳後の md
 */
export class IpynbProcessorImpl extends MdProcessorImpl {
  async process(file: string): Promise<string> {
    logger.verbose('IpynbProcessor.process', file);
    const text = readFileSync(file, 'utf-8');
    const json = JSON.parse(text);
    const cells = json.cells;
    for (const cell of cells) {
      if (cell.cell_type === 'markdown') {
        const md = (cell.source as string[]).join('');
        const result = await this.parseMd(md, false);
        cell.source = result.split('\n');
      }
    }
    return JSON.stringify(json, null, 1);
  }
}
