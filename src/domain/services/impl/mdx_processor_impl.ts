import { IAppContext } from '../../../shared/app_context.js';
import { MdDoc, MdDocId } from '../../md_doc.js';
import { IParseResult, MdProcessorImpl } from './md_processor_impl.js';
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
      if (tnode.srcText.match(/^\s*import\s+DocCardList\s+from\s+["']@theme/)) {
        removeIndexes.push(i);
        continue;
      }
      // Admonitions
      // https://docusaurus.io/docs/next/markdown-features/admonitions
      // 例: :::info
      if (tnode.srcText.match(/^:::+(note|tips|info|warning|danger)?/)) {
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
      if (tnode.type === ':::') {
        let replaceNodes: RootContent[] = [];
        const matches1 = tnode.srcText.match(
          /^(:::\S+\r?\n+)?(.+?)(:::\r?\n+)?/
        );
        if (matches1) {
          const text = matches1[2];
          const nodes = await this.translateDocusaurusAdminition(ctx, text);
          if (nodes) {
            replaceNodes.push({
              type: 'paragraph',
              children: [
                {
                  type: 'text',
                  value: matches1[1],
                } as Text,
              ],
            });
            replaceNodes = replaceNodes.concat(nodes);
            if (matches1[3] && matches1[3].length > 0) {
              replaceNodes.push({
                type: 'paragraph',
                children: [
                  {
                    type: 'text',
                    value: matches1[3],
                  } as Text,
                ],
              });
            }
          } else {
            throw new Error('nodes is undefined');
          }
        } else {
          const matches2 = tnode.srcText.match(/^(:::\r?\n+)/);
          if (matches2) {
            replaceNodes.push({
              type: 'paragraph',
              children: [
                {
                  type: 'text',
                  value: matches2[1],
                } as Text,
              ],
            });
          } else {
            throw new Error('nodes is undefined');
          }
        }
      }
    }
    await super.translateNodes(ctx, result);
  }

  private async translateDocusaurusAdminition(
    ctx: IAppContext,
    text: string
  ): Promise<RootContent[] | undefined> {
    if (text === '') {
      return undefined;
    }
    let replaceNodes: RootContent[] = [];
    const translated = await this.translateParagraph(text);
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
