import { readFileSync, writeFileSync } from 'fs';
import { glob } from 'glob';
import path from 'path';
import fs from 'fs';
import * as crypto from 'crypto';
import { logger } from '../shared/logger.js';
import { Config } from '../shared/config.js';
import { IMdProcessorFactory } from '../domain/services/md_processor.js';
import { IMdHashRepository } from '../domain/repository/md_hash_repository.js';
import { IAppContext } from '../shared/app_context.js';
import { MdHash } from '../domain/md_hash.js';

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

const copyFile = (srcfile: string, dstfile: string): void => {
  logger.verbose('copyFile', srcfile, dstfile);
  // ディレクトリがない場合は作成する
  const dir = path.dirname(dstfile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.copyFileSync(srcfile, dstfile);
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
  constructor(
    private mdProcessorFactory: IMdProcessorFactory,
    private mdHashRepository: IMdHashRepository
  ) {}

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
    const totalCount = files.length;
    let index = 0;
    for (const file of files) {
      index++;
      if (fs.lstatSync(file).isDirectory()) {
        continue;
      }
      if (file.match(/\/\.git\//)) {
        continue;
      }
      const ext = path.extname(file).toLowerCase();
      const outputFilePath = getOutputFilePath(file, baseDir, output);
      logger.info(`(${index}/${totalCount}) ${file} ...`);
      const mdProcessor = this.mdProcessorFactory.getProcessor(ext);
      if (!mdProcessor) {
        // 処理する processor がないときには、ファイルをコピー
        copyFile(file, outputFilePath);
        logger.info(`${outputFilePath} copied`);
        continue;
      }
      const data = readFileSync(file, 'utf-8');
      const hash = crypto.createHash('sha256').update(data).digest('hex');
      let mdHash = await this.mdHashRepository.getByFile(file);
      if (fs.existsSync(outputFilePath)) {
        logger.verbose(
          `hash: src: ${hash} / db: ${mdHash ? mdHash.hash : 'none'}`
        );
        if (mdHash && mdHash.hash == hash) {
          if (!Config.IS_OVERWRITE) {
            logger.info(`${file} no modified`);
            continue;
          }
        }
      }
      ctx.file = file;
      ctx.nodeNo = 1;
      const result = await mdProcessor.process(ctx, data);
      writeTranslatedMd(outputFilePath, result);
      if (!mdHash) {
        mdHash = new MdHash(file, hash);
      } else {
        mdHash = mdHash.renewHash(hash);
      }
      await this.mdHashRepository.save(mdHash);
      logger.info(`${file} writed to ${outputFilePath}`);
    }
  }
}
