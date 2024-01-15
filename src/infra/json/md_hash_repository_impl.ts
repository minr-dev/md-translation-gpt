import { MdHash } from '../../domain/md_hash.js';
import { IMdHashRepository } from '../../domain/repository/md_hash_repository.js';
import { IEntityFactory, JsonClient } from './json_client.js';

const JSON_NAME = 'md_hash_db.json';

class MdHashEntityFactoryImpl implements IEntityFactory<MdHash> {
  create(data: Record<string, string>): MdHash {
    return new MdHash(data.file, data.hash);
  }
}

export class MdHashRepositoryImpl implements IMdHashRepository {
  private client = new JsonClient<MdHash>(
    JSON_NAME,
    new MdHashEntityFactoryImpl()
  );

  async save(mdHash: MdHash): Promise<void> {
    await this.client.save(mdHash);
  }

  async getByFile(file: string): Promise<MdHash | undefined> {
    const rows = await this.client.rows();
    return rows.get(file);
  }

  async deleteByFile(id: string): Promise<void> {
    await this.client.deleteById(id);
  }
}
