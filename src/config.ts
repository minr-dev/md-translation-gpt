import dotenv from 'dotenv';

const result = dotenv.config();
if (result.error) {
  throw result.error;
}

export const Config = {
  translationCorrectnessThreshold: 0.9,
  isOverwrite: false,
  isVerbose: false,
  opeanAIApiKey: process.env.OPENAI_API_KEY || '',
};
