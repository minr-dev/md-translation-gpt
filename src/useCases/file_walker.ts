import { readFileSync, writeFileSync } from 'fs';
import { glob } from 'glob';
import path from 'path';
import fs from 'fs';
import { logger } from '../shared/logger.js';
import { Config } from '../shared/config.js';
import { IMdProcessorFactory } from '../domain/services/md_processor.js';
import { IAppContext } from '../shared/app_context.js';

/**
 * 翻訳結果をファイルに書き込む
 *
 * 翻訳後のファイルがあれば、元のファイルを .bk でバックアップする
 * すでに .bk がある場合は、上書きしない
 *
 * @param file ファイル名
 * @param text 翻訳結果
 */
const writeTranslatedMd = (file: string, text: string): void => {
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

export class FileWalker {
  constructor(private mdProcessorFactory: IMdProcessorFactory) {}

  /**
   * glob パターンに一致するファイルを走査して処理を実行する
   *
   * ファイルは、 md, mdx, ipynb のみ処理する
   *
   * @param pattern glob パターン
   * @param output 出力先ディレクトリ
   */
  async walk(ctx: IAppContext, pattern: string, output: string): Promise<void> {
    logger.verbose('pattern', pattern);
    const files = glob.globSync(pattern);
    const baseDir = getBaseDir(pattern);
    for (const file of files) {
      if (fs.lstatSync(file).isDirectory()) {
        continue;
      }
      const ext = path.extname(file).toLowerCase();
      const outputFilePath = getOutputFilePath(file, baseDir, output);
      if (fs.existsSync(outputFilePath)) {
        if (!Config.IS_OVERWRITE) {
          logger.info(`${outputFilePath} exists`);
          continue;
        }
      }
      logger.info(`${file} ...`);
      const data = readFileSync(file, 'utf-8');
      const mdProcessor = this.mdProcessorFactory.getProcessor(ext);
      if (!mdProcessor) {
        logger.info(`${file} skipped`);
        continue;
      }
      ctx.file = file;
      ctx.nodeNo = 1;
      const result = await mdProcessor.process(ctx, data);
      writeTranslatedMd(outputFilePath, result);
      logger.info(`${file} writed to ${outputFilePath}`);
    }
  }
}
