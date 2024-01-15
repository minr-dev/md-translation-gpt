import { LanceDB } from '@langchain/community/vectorstores/lancedb';
import { Document } from 'langchain/document';
import { DocumentInterface } from '@langchain/core/documents.js';
import { OpenAIEmbeddings } from 'langchain/embeddings/openai';
import { Embeddings } from '@langchain/core/embeddings.js';
import { connect } from 'vectordb';
import { Config } from '../../shared/config.js';
import { logger } from '../../shared/logger.js';
import path from 'path';

const DEFAULT_TABLE_NAME = 'md-translation-db';
// lancedbのスキーマはダミーの1レコードから作成される。
// また vector と text は必須
const DEFAULT_SCHEMA = {
  vector: Array(1536),
  text: 'sample',
  file: 'sample',
  nodeNo: 1,
  type: 'sample',
  ja: 'sample',
};

export class LanceDBClient {
  private _embeddings: Embeddings | undefined;
  private _vectorStore: LanceDB | undefined;

  constructor(
    readonly tableName = DEFAULT_TABLE_NAME,
    readonly schema: Record<string, unknown> = DEFAULT_SCHEMA
  ) {}

  async save(data: Document): Promise<void> {
    const docs = [data];
    const vectorStore = await this.vectorStore();
    await vectorStore.addDocuments(docs);
  }

  async similaritySearchWithScore(
    pageContent: string,
    k: number
  ): Promise<[DocumentInterface, number][]> {
    const vectorStore = await this.vectorStore();
    const results = await vectorStore.similaritySearchWithScore(pageContent, k);
    logger.debug('LanceDBClient.similaritySearchWithScore results', results);
    return results;
  }

  async vectorStore(): Promise<LanceDB> {
    if (this._vectorStore) {
      return this._vectorStore;
    }
    const dir = path.join(Config.DATA_DIR, 'lancedb');
    const db = await connect(dir);
    const tableNames = await db.tableNames();
    let table;
    if (tableNames.includes(this.tableName)) {
      table = await db.openTable(this.tableName);
    } else {
      table = await db.createTable(this.tableName, [this.schema]);
    }
    this._vectorStore = new LanceDB(this.getEmbeddings(), { table });
    return this._vectorStore;
  }

  getEmbeddings(): Embeddings {
    if (this._embeddings) {
      return this._embeddings;
    }
    this._embeddings = new OpenAIEmbeddings();
    return this._embeddings;
  }
}
