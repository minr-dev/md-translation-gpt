import { Document } from 'langchain/document';
import { MdDoc, MdDocId } from '../../domain/md_doc.js';
import { IMdDocRepository } from '../../domain/repository/md_doc_repository.js';
import { LanceDBClient } from './lancedb_client.js';
import { logger } from '../../shared/logger.js';
import { DocumentInterface } from '@langchain/core/documents';

export class MdDocRepositoryImpl implements IMdDocRepository {
  private client = new LanceDBClient();

  async save(mdDoc: MdDoc): Promise<void> {
    const doc = new Document({
      metadata: {
        file: mdDoc.id.file,
        nodeNo: mdDoc.id.nodeNo,
        type: mdDoc.type,
        ja: mdDoc.ja,
      },
      pageContent: mdDoc.en,
    });
    await this.client.save(doc);
    console.log('MdDocRepositoryImpl.save doc', doc);
  }

  async getByEn(en: string): Promise<MdDoc | undefined> {
    logger.debug('getByEn', en);
    const results = await this.client.similaritySearchWithScore(en, 1);
    logger.debug('results', results);
    const mdDocs = this.parseResults(results, 0.0);
    if (mdDocs.length === 0) {
      return undefined;
    }
    return mdDocs[0];
  }

  private parseResults(
    results: [DocumentInterface<Record<string, any>>, number][],
    threshold: number
  ): MdDoc[] {
    if (results.length === 0) {
      return [];
    }
    const mdDocs: MdDoc[] = [];
    for (const result of results) {
      const score = result[1];
      if (score < threshold) {
        continue;
      }
      const metadata = result[0].metadata as {
        file: string;
        nodeNo: number;
        type: 'heading' | 'paragraph';
        ja: string;
      };
      const pageContent = result[0].pageContent;
      mdDocs.push(
        new MdDoc(
          new MdDocId(metadata.file, metadata.nodeNo),
          metadata.type,
          pageContent,
          metadata.ja
        )
      );
    }
    return mdDocs;
  }
}
