import { logger } from '../../../shared/logger.js';
import { AppContext } from '../../../shared/app_context.js';
import { IMdProcessor } from '../md_processor.js';

export class IpynbProcessorImpl implements IMdProcessor {
  constructor(private mdProcessor: IMdProcessor) {}

  /**
   * ipynb を処理する
   *
   * @param file ファイル名
   * @returns 翻訳後の md
   */
  async process(ctx: AppContext, data: string): Promise<string> {
    logger.verbose('IpynbProcessor.process');
    const json = JSON.parse(data);
    const cells = json.cells;
    for (const cell of cells) {
      if (cell.cell_type === 'markdown') {
        const md = (cell.source as string[]).join('');
        const result = await this.mdProcessor.process(ctx, md);
        cell.source = result.split('\n');
      }
    }
    return JSON.stringify(json, null, 1);
  }
}
