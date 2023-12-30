import path from 'path';
import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { logger, LogLevel } from './logger.js';
import { Config } from './config.js';
import { MdFileWalker } from './mdFileWalker.js';
import { IpynbProcessorImpl, MdProcessorImpl } from './md.js';
import { ProofreadTranslatorImpl } from './translate.js';
import { LlmImpl } from './llm.js';

const moduleDir = fileURLToPath(new URL('.', import.meta.url));

const packageJsonPath = path.join(moduleDir, '../package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
const version: string = packageJson.version;

const program = new Command();

(async (): Promise<void> => {
  program
    .version(version)
    .name('md-translation-gpt')
    .option('-d, --debug', 'enables verbose logging', false)
    .requiredOption('-p, --pattern <pattern>', 'glob pattern to process files')
    .requiredOption('-o, --output <output>', 'output directory')
    .option('-f, --force', 'overwrite existing files', false)
    .option(
      '-a, --accuracy <number>',
      'set translation accuracy threshold',
      value => {
        const parsedValue = parseFloat(value);
        if (isNaN(parsedValue) || parsedValue < 0 || parsedValue > 1) {
          throw new Error('Accuracy must be a number between 0 and 1');
        }
        return parsedValue;
      },
      0.9
    )
    .action(async (request: any): Promise<void> => {
      try {
        if (request.debug) {
          logger.setLogLevel(LogLevel.VERBOSE);
        }
        Config.translationCorrectnessThreshold = request.accuracy;
        Config.isOverwrite = request.force;
        Config.isVerbose = request.debug;
        if (Config.opeanAIApiKey === '') {
          throw new Error('OPENAI_API_KEY is not set');
        }
        const llm = new LlmImpl();
        const translator = new ProofreadTranslatorImpl(llm);
        const walker = new MdFileWalker(
          new MdProcessorImpl(translator),
          new IpynbProcessorImpl(translator)
        );
        await walker.walk(request.pattern as string, request.output as string);
        logger.info('success');
      } catch (e) {
        let debug = true;
        if (request.debug !== undefined) {
          debug = request.debug;
        }
        const eany = e as any;
        if (e instanceof Error) {
          if (debug) {
            logger.error(e.stack);
          } else {
            logger.error(e.message);
          }
        } else if (eany['statusCode']) {
          logger.error('Error');
          logger.error(`statusCode: ${eany['statusCode']}`);
          logger.error(`statusMessage: ${eany['statusMessage']}`);
          logger.error(`body: ${eany['body']}`);
        } else {
          logger.error(e);
        }
      }
    });

  await program.parseAsync(process.argv);
})().catch(e => {
  logger.error(e);
  throw e;
});
