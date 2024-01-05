import { MdHash } from '../../domain/md_hash.js';

export interface IMdHashRepository {
  save(mdHash: MdHash): Promise<void>;
  getByFile(id: string): Promise<MdHash | undefined>;
}
