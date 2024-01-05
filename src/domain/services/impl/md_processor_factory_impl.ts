import { IMdProcessorFactory, IMdProcessor } from '../md_processor.js';
import { IpynbProcessorImpl } from './ipynb_processor_impl.js';
import { MdxProcessorImpl } from './mdx_processor_impl.js';
import { MdProcessorImpl } from './md_processor_impl.js';
import { ITranslator } from '../translator.js';
import { IMdDocRepository } from '../../repository/md_doc_repository.js';

export class MdProcessorFactoryImpl implements IMdProcessorFactory {
  constructor(
    private translator: ITranslator,
    private mdDocRepository: IMdDocRepository
  ) {}

  getProcessor(ext: string): IMdProcessor | undefined {
    let processor: MdxProcessorImpl | undefined;

    switch (ext) {
      case '.md':
        return new MdProcessorImpl(this.translator, this.mdDocRepository);
      case '.mdx':
        return new MdxProcessorImpl(this.translator, this.mdDocRepository);
      case '.ipynb':
        processor = new MdxProcessorImpl(this.translator, this.mdDocRepository);
        return new IpynbProcessorImpl(processor);
      default:
        return undefined;
    }
  }
}
