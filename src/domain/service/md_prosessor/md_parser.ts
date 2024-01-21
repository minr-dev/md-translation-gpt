import { remark } from 'remark';
import stringify from 'remark-stringify';
import { visit } from 'unist-util-visit';
import { Node } from 'unist';
import { Root } from 'mdast';
import frontmatter from 'remark-frontmatter';

/**
 * blockquote のフォーマットを整える
 *
 * blockquote の前後に空行が無い場合には、空行を挿入して整形する
 *
 * @returns
 */
export const insertBlankLinesAroundBlockquotes = () => (tree: Node) => {
  const root = tree as Root;

  if (root.children.length === 0) {
    return;
  }

  const mdFirstLine =
    root.children[0].position && root.children[0].position.start.line;
  if (!mdFirstLine) {
    return;
  }

  // 最初の visit で blockquote のノードの position を取得して配列にして、
  // 2回目の visit では、blockquote のノードの position に最も近い ノード を探して
  // blockquote との行が何行離れているかを調べられるようにする
  const blockquotePositions: {
    startLineIndex: number;
    startOffset: number;
    endLineIndex: number;
    endOffset: number;
    prevLineIndex: number;
    nextLineIndex: number;
  }[] = [];
  visit(tree, 'blockquote', (node: Node) => {
    const startLine = node.position?.start.line || mdFirstLine;
    const endLine = node.position?.end.line || mdFirstLine;
    const startOffset = node.position?.start.offset || 0;
    const endOffset = node.position?.end.offset || 0;
    blockquotePositions.push({
      startLineIndex: startLine - mdFirstLine,
      startOffset: startOffset,
      endLineIndex: endLine - mdFirstLine,
      endOffset: endOffset,
      prevLineIndex: 0,
      nextLineIndex: Number.MAX_SAFE_INTEGER,
    });
  });
  visit(tree, (node: Node) => {
    if (node.type === 'blockquote') {
      return;
    }
    const notbqStartLine =
      (node.position?.start.line || mdFirstLine) - mdFirstLine;
    const notbqEndLine = (node.position?.end.line || mdFirstLine) - mdFirstLine;
    const notbqStartOffset = node.position?.start.offset || 0;
    const notbqEndOffset = node.position?.end.offset || 0;
    for (const bq of blockquotePositions) {
      if (
        bq.startOffset >= notbqEndOffset &&
        bq.prevLineIndex <= notbqEndLine
      ) {
        bq.prevLineIndex = notbqEndLine;
      }
      if (
        bq.endOffset <= notbqStartOffset &&
        bq.nextLineIndex >= notbqStartLine
      ) {
        bq.nextLineIndex = notbqStartLine;
      }
    }
  });

  if (blockquotePositions.length === 0) {
    return;
  }

  // stringify でテキスト化して、行単位の配列に分割して、
  // blockquote の行の前後に空行が無い場合には、空行を配列に追加する
  // blockquotePositions を最後方から処理することで、
  // 配列位置の計算（行インデックス）の再計算を不要にする
  const md = generalProcessor.stringify(root);
  let reformLines = md.split('\n');
  for (const bq of blockquotePositions.reverse()) {
    if (bq.nextLineIndex - bq.endLineIndex < 2) {
      const pos = bq.nextLineIndex;
      reformLines = reformLines
        .slice(0, pos)
        .concat([''])
        .concat(reformLines.slice(pos));
    }
    if (bq.startLineIndex - bq.prevLineIndex < 2) {
      const pos = bq.startLineIndex;
      reformLines = reformLines
        .slice(0, pos)
        .concat([''])
        .concat(reformLines.slice(pos));
    }
  }

  // 行配列をテキストにして、 processor.parse でツリーにして、
  // children を置き替えて、tree の中身を置き替える
  const reformMd = reformLines.join('\n');
  const newTree = generalProcessor.parse(reformMd);
  root.children = newTree.children;
};

/**
 * 通常の AST を作る
 */
export const generalProcessor = remark()
  .use(frontmatter, ['yaml'])
  .use(stringify);

/**
 * blockquote を整形した AST を作る
 *
 * 変換された MD を quarto や docuraurus などで再変換するときに、
 * blockquote 部分の整形不良でレイアウトが崩れることを確認しているため、
 * blockquote の前後の行には空行を入れるように整形する
 */
export const blockquoteBeautifyProcessor = remark()
  .use(frontmatter, ['yaml'])
  .use(insertBlankLinesAroundBlockquotes)
  .use(stringify);
