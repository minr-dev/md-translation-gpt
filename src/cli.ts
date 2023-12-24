import { Command } from 'commander';
import { readFileSync } from 'fs';
import { glob } from 'glob';
import path, { join } from 'path';
import { fileURLToPath } from 'url';

const moduleDir = fileURLToPath(new URL('.', import.meta.url));

const packageJsonPath = join(moduleDir, '../package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
const version: string = packageJson.version;

/**
 * md と mdx を処理する
 */
const processMd = (file: string) => {
  // ここにファイルを処理するコードを書く
  // console.log(file);
};

/**
 * ipynb を処理する
 */
const processIpynb = (file: string) => {
  // ここにファイルを処理するコードを書く
  // console.log(file);
};

/**
 * glob パターンに一致するファイルを取得して処理する
 *
 * ファイルは、 md, mdx, ipynb のみ処理する
 *
 * @param pattern glob パターン
 */
const processFiles = (pattern: string) => {
  console.log('pattern', pattern);
  const files = glob.globSync(pattern);
  for (const file of files) {
    // 拡張子を取得して、処理するファイルかどうかを判定する
    const ext = path.extname(file).toLowerCase();
    if ('.md' === ext || '.mdx' === ext) {
      processMd(file);
    } else if ('.ipynb' === ext) {
      processIpynb(file);
    }
  }
  console.error('success');
};

const program = new Command();

program
  .version(version)
  .name('md-translation-gpt')
  .option('-d, --debug', 'enables verbose logging', false)
  .requiredOption(
    '-p, --pattern <pattern>',
    'glob pattern to process files',
    processFiles
  )
  .parse(process.argv);
