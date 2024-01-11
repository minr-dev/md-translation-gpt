import { logger } from '../../../shared/logger.js';
import { IAppContext } from '../../../shared/app_context.js';
import { MdDoc, MdDocId } from '../../md_doc.js';
import {
  IParseResult,
  ITargetNode,
  MdProcessorImpl,
} from './md_processor_impl.js';
import { Text, Blockquote, PhrasingContent, RootContent } from 'mdast';

/**
 * mdx の翻訳クラス
 *
 * md の処理に加えて、Docusaurus の 独自シンタックスのいくつかを処理する
 */
export class MdxProcessorImpl extends MdProcessorImpl {
  protected async parseMd(md: string): Promise<IParseResult> {
    const result = await super.parseMd(md);
    this.parseDocusaurusSyntax(result);
    return result;
  }

  parseDocusaurusSyntax(result: IParseResult): void {
    const removeIndexes: number[] = [];
    for (let i = 0; i < result.tnodes.length; i++) {
      const tnode = result.tnodes[i];
      // https://docusaurus.io/docs/next/markdown-features/toc#inline-table-of-contents
      // 例: import TOCInline from '@theme/TOCInline';
      if (
        tnode.targetText.match(/^\s*import\s+DocCardList\s+from\s+["']@theme/)
      ) {
        removeIndexes.push(i);
        continue;
      }
      // Admonitions
      // https://docusaurus.io/docs/next/markdown-features/admonitions
      // 例: :::info
      if (tnode.targetText.match(/^:::+(\S+)?/)) {
        tnode.type = ':::';
        continue;
      }
    }
    for (const index of removeIndexes.reverse()) {
      result.tnodes.splice(index, 1);
    }
  }

  protected async translateNodes(
    ctx: IAppContext,
    result: IParseResult
  ): Promise<void> {
    for (const tnode of result.tnodes) {
      if (tnode.type !== ':::') {
        continue;
      }
      logger.verbose('MdProcessor.process');
      let replaceNodes: RootContent[] = [];
      const lines = tnode.targetText.split(/\r?\n/);
      let text = '';
      for (const line of lines) {
        const admonitionsMaches = line.match(/^:::(\S+)?/);
        if (admonitionsMaches) {
          // admonitions の終わりの行で、且つ、text が空でないときに翻訳する
          if (!admonitionsMaches[1] && text.trim() !== '') {
            const nodes = await this.translateDocusaurusAdminition(
              ctx,
              tnode,
              text
            );
            if (nodes) {
              replaceNodes = replaceNodes.concat(nodes);
            } else {
              throw new Error('nodes is undefined');
            }
          }
          replaceNodes.push({
            type: 'paragraph',
            children: [
              {
                type: 'text',
                value: line,
              } as Text,
            ],
          });
          text = '';
          continue;
        }
        text += line + '\n';
      }
      if (text.trim() !== '') {
        const nodes = await this.translateDocusaurusAdminition(
          ctx,
          tnode,
          text
        );
        if (nodes) {
          replaceNodes = replaceNodes.concat(nodes);
        } else {
          throw new Error('nodes is undefined');
        }
      }
      tnode.replaceNodes = replaceNodes;
    }
    await super.translateNodes(ctx, result);
  }

  private async translateDocusaurusAdminition(
    ctx: IAppContext,
    tnode: ITargetNode,
    text: string
  ): Promise<RootContent[] | undefined> {
    if (text === '') {
      return undefined;
    }
    let replaceNodes: RootContent[] = [];
    // tnode をコピーして、新しい tnode に targetText をセットする
    const newTnode = Object.assign({}, tnode);
    newTnode.targetText = text;

    const translated = await this.translateParagraph(newTnode);
    const mdDoc = new MdDoc(
      new MdDocId(ctx.file, ctx.nodeNo),
      'paragraph',
      text,
      translated
    );
    await this.mdDocRepository.save(mdDoc);
    if (translated != text) {
      const translatedRoot = this.processor.parse(translated);
      replaceNodes = translatedRoot.children;
      const originalRoot = this.processor.parse(text);
      const blockquote = {
        type: 'blockquote',
        children: originalRoot.children as PhrasingContent[],
      } as Blockquote;
      replaceNodes.push(blockquote as unknown as PhrasingContent);
    }
    return replaceNodes;
  }
}
