import path from 'path';
import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { logger, LogLevel } from './shared/logger.js';
import { Config } from './shared/config.js';
import { FileWalker } from './useCases/file_walker.js';
import { OpenAIModel } from './infra/llm/openai_model.js';
import { MdDocRepositoryImpl } from './infra/vector/md_doc_repository_impl.js';
import { MdHashRepositoryImpl } from './infra/json/md_hash_repository_impl.js';
import { MdProcessorFactoryImpl } from './domain/service/md_prosessor/md_processor_factory_impl.js';
import { ProofreadTranslatorImpl } from './domain/service/translator/proofread_translator_impl.js';
import { AppContext } from './shared/app_context.js';

const moduleDir = fileURLToPath(new URL('.', import.meta.url));

const packageJsonPath = path.join(moduleDir, '../package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
const version: string = packageJson.version;

const program = new Command();

(async (): Promise<void> => {
  program
    .version(version)
    .name('md-translation-gpt')
    .option('-v, --verbose', 'enables verbose logging', false)
    .requiredOption(
      '-p, --pattern <pattern>',
      'source files using a glob pattern'
    )
    .requiredOption('-o, --output <output>', 'output directory')
    .option('-f, --force', 'overwrite existing files', false)
    .option(
      '-d, --delete',
      'Deletes files that exist only in the output directory and not in the input directory',
      false
    )
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
      0.97
    )
    .action(async (request: any): Promise<void> => {
      try {
        Config.TRANSLATION_CORRECTNESS_THRESHOLD = request.accuracy;
        Config.IS_OVERWRITE = request.force;
        Config.IS_VERBOSE = request.verbose;
        Config.SYNC_DELETE = request.delete;
        if (Config.IS_VERBOSE) {
          logger.setLogLevel(LogLevel.VERBOSE);
        }
        if (Config.OPENAI_API_KEY === '') {
          throw new Error('OPENAI_API_KEY is not set');
        }
        const llm = new OpenAIModel();
        const translator = new ProofreadTranslatorImpl(llm);
        const mdDocRepository = new MdDocRepositoryImpl();
        const mdHashRepository = new MdHashRepositoryImpl(
          request.output as string
        );
        const mdProcessorFactory = new MdProcessorFactoryImpl(
          translator,
          mdDocRepository
        );
        const ctx = AppContext.init();
        const walker = new FileWalker(mdProcessorFactory, mdHashRepository);
        await walker.walk(
          ctx,
          request.pattern as string,
          request.output as string
        );
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
