import { MdDoc } from '../../domain/md_doc.js';

export interface IMdDocRepository {
  save(mdDoc: MdDoc): Promise<void>;
  getByEn(en: string): Promise<MdDoc | undefined>;
}
