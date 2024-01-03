import {
  IMdProcessor,
  IMdProcessorFactory,
  ITranslator,
} from './interfaces.js';
import { IpynbProcessorImpl } from './Ipynb_processor.js';
import { MdxProcessorImpl } from './mdx_processor.js';
import { MdProcessorImpl } from './md_processor.js';

export class MdProcessorFactoryImpl implements IMdProcessorFactory {
  constructor(private translator: ITranslator) {}

  getProcessor(ext: string): IMdProcessor | undefined {
    let processor: MdxProcessorImpl | undefined;

    switch (ext) {
      case '.md':
        return new MdProcessorImpl(this.translator);
      case '.mdx':
        return new MdxProcessorImpl(this.translator);
      case '.ipynb':
        processor = new MdxProcessorImpl(this.translator);
        return new IpynbProcessorImpl(processor);
      default:
        return undefined;
    }
  }
}
