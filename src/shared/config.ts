import dotenv from 'dotenv';

const result = dotenv.config();
if (result.error) {
  throw result.error;
}

export const Config = {
  TRANSLATION_CORRECTNESS_THRESHOLD: 0.9,
  IS_OVERWRITE: false,
  IS_VERBOSE: false,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  LANCEDB_DIR: process.env.LANCEDB_DIR || '',

  PINECONE_API_KEY: process.env.PINECONE_API_KEY || '',
  PINECONE_ENVIRONMENT: process.env.PINECONE_ENVIRONMENT || '',
  PINECONE_INDEX_NAME: process.env.PINECONE_INDEX_NAME || '',
  EMBEDDINGS_MODEL_PATH: process.env.EMBEDDINGS_MODEL_PATH || '',
  CHROMA_COLLECTIO_NNAME: process.env.CHROMA_COLLECTIO_NNAME || '',
  CHROMA_URL: process.env.CHROMA_URL || '',
};
