#!/usr/bin/env node

import { Command, Option, InvalidArgumentError } from 'commander';
import { writeFile, access } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { generateApp } from './interact.js';
import { config } from 'dotenv';
import * as lz4 from 'lz4-wasm-nodejs';
// Helper for consistent logging to stderr
const log = (...args: any[]) => console.error(...args);

// Find and load the nearest .env.local file
const findAndLoadEnv = async () => {
  const cwd = process.cwd();
  const possiblePaths = [join(cwd, '.env.local'), join(dirname(cwd), '.env.local')];

  for (const path of possiblePaths) {
    try {
      await access(path);
      config({ path });
      log(`✓ Found and loaded environment from ${path}`);
      return;
    } catch {
      continue;
    }
  }
};

// Load environment before setting up the program
await findAndLoadEnv();

interface GenerateOptions {
  zapdevUrl?: string;
  prod?: boolean;
  dev?: boolean;
  localBuild?: boolean;
  outputDir?: string;
  messagesFile?: string;
  messages?: boolean;
  force?: boolean;
  headless: boolean;
}

const generateCommand = new Command('generate')
  .description('Generate an app using ZapDev AI')
  .argument('<prompt>', 'The prompt to send to ZapDev')
  // URL group - mutually exclusive options
  .addOption(
    new Option('--zapdev-url <url>', 'Custom ZapDev URL')
      .conflicts(['prod', 'dev', 'local-build'])
      .argParser((value: string) => {
        try {
          new URL(value);
          return value;
        } catch {
          throw new InvalidArgumentError('Not a valid URL');
        }
      }),
  )
  .addOption(
    new Option('--prod', 'Use production ZapDev at zapdev.convex.dev').conflicts(['zapdev-url', 'dev', 'local-build']),
  )
  .addOption(
    new Option('--dev', 'Use local dev server at http://127.0.0.1:5173').conflicts(['zapdev-url', 'prod', 'local-build']),
  )
  .addOption(
    new Option('--local-build', 'Build (if needed) and run local server at http://localhost:3000')
      .conflicts(['zapdev-url', 'prod', 'dev'])
      .default(true),
  )
  // Output directory options
  .addOption(new Option('--output-dir <dir>', 'Directory to output the generated code'))
  // Messages output group - mutually exclusive options
  .addOption(new Option('--messages-file <file>', 'File to write conversation messages to').conflicts(['messages']))
  .addOption(new Option('--messages', 'Write messages to stdout').conflicts(['messages-file']))
  // Other options
  .addOption(new Option('-f, --force', 'Overwrite output directory if it exists'))
  // Headless mode options
  .option('--headless', 'run in headless mode', true)
  .option('--no-headless', 'show browser window')
  // Hidden options
  .addOption(
    new Option('--headed', 'show browser window').hideHelp().conflicts(['no-headless']).preset({ headless: false }),
  )
  .action(async (prompt: string, options: GenerateOptions) => {
    let zapdevUrl: string;
    if (options.dev) {
      zapdevUrl = 'http://127.0.0.1:5173';
    } else if (options.prod) {
      zapdevUrl = 'https://zapdev.convex.dev';
    } else if (options.zapdevUrl) {
      zapdevUrl = options.zapdevUrl;
    } else {
      // Default to local-build behavior
      zapdevUrl = 'http://localhost:3000';
    }
    log(`Looking for ZapDev at ${zapdevUrl}`);

    // Check for required environment variables
    const email = process.env.ZAPDEV_EVAL_USER_EMAIL;
    const password = process.env.ZAPDEV_EVAL_USER_PASSWORD;

    if (!email || !password) {
      log('Error: Missing required environment variables');
      log('Please set ZAPDEV_EVAL_USER_EMAIL and ZAPDEV_EVAL_USER_PASSWORD in your .env.local file');
      process.exit(1);
    }

    // Check output directory if provided
    const outputDir = options.outputDir ? resolve(options.outputDir) : undefined;
    if (outputDir) {
      try {
        await access(outputDir);
        if (!options.force) {
          log(`Error: Output directory ${outputDir} already exists. Use --force to overwrite.`);
          process.exit(1);
        }
        log(`Warning: Output directory ${outputDir} exists, will overwrite due to --force`);
      } catch {
        // Directory doesn't exist, which is what we want
        log(`Will generate code in ${outputDir}`);
      }
    } else {
      log('No output directory specified, code will not be saved');
    }

    const { messages, outputDir: finalOutputDir } = await generateApp({
      prompt,
      zapdevUrl,
      outputDir,
      headless: options.headless,
      credentials: {
        email,
        password,
      },
    });

    // Handle messages output
    if (options.messagesFile) {
      const messagesPath = resolve(options.messagesFile);
      await writeFile(messagesPath, JSON.stringify(messages, null, 2));
      log(`Wrote messages to ${messagesPath}`);
    } else if (options.messages) {
      // Write to stdout for piping
      console.log(JSON.stringify(messages, null, 2));
    }

    if (finalOutputDir) {
      log(`Generated app in ${finalOutputDir}`);
    } else {
      log('Tip: Use --output-dir to save the generated code');
    }
  });

interface DownloadOptions {
  zapdevSiteUrl: string;
  dev?: boolean;
  prod?: boolean;
  messagesFile?: string;
  messagesRawFile?: string;
  messages?: boolean;
}

const downloadCommand = new Command('download')
  .description('Download an app using ZapDev AI')
  .argument('chatUuid', 'The UUID of the chat to download')
  // URL group - mutually exclusive options
  .addOption(
    new Option('--zapdev-site-url <url>', 'ZapDev site URL').conflicts(['prod', 'dev']).argParser((value: string) => {
      try {
        new URL(value);
        return value;
      } catch {
        throw new InvalidArgumentError('Not a valid URL');
      }
    }),
  )
  .addOption(new Option('--prod', 'Use production ZapDev database').conflicts(['zapdev-backend-url', 'dev']))
  .addOption(new Option('--dev', 'Use dev ZapDev database configured in .env.local').conflicts(['zapdev-site-url', 'prod']))
  .addOption(new Option('--messages-file <file>', 'File to write the parsed (JSON) messages to'))
  .addOption(new Option('--messages-raw-file <file>', 'File to write the compressed messages to'))
  .action(async (chatUuid: string, options: DownloadOptions) => {
    let zapdevSiteUrl: string | undefined;
    if (options.dev) {
      if (process.env.VITE_CONVEX_SITE_URL) {
        zapdevSiteUrl = process.env.VITE_CONVEX_SITE_URL;
      } else if (process.env.CONVEX_URL) {
        const convexUrl = process.env.CONVEX_URL;
        if (convexUrl.endsWith('.convex.cloud')) {
          zapdevSiteUrl = convexUrl.replace('.convex.cloud', '.convex.site');
        }
      }
    } else if (options.prod) {
      zapdevSiteUrl = 'https://academic-mammoth-217.convex.site';
    } else if (options.zapdevSiteUrl) {
      zapdevSiteUrl = options.zapdevSiteUrl;
    }
    if (!zapdevSiteUrl) {
      log('Error: Missing required environment variables');
      log('Please set CONVEX_URL in your .env.local file or run with --zapdev-site-url or --prod');
      process.exit(1);
    }
    log(`Looking for ZapDev at ${zapdevSiteUrl}`);
    const zapdevAdminToken = process.env.ZAPDEV_ADMIN_TOKEN || process.env.CHEF_ADMIN_TOKEN;
    if (!zapdevAdminToken) {
      log('Error: Missing required environment variables');
      log('Please set ZAPDEV_ADMIN_TOKEN in your .env.local file');
      process.exit(1);
    }

    const response = await fetch(`${zapdevSiteUrl}/__debug/download_messages`, {
      method: 'POST',
      body: JSON.stringify({ chatUuid }),
      headers: {
        'X-Chef-Admin-Token': zapdevAdminToken,
      },
    });
    if (!response.ok) {
      log(`Error: ${response.statusText}`);
      process.exit(1);
    }

    const messagesBlob = await response.arrayBuffer();
    const messageBytes = new Uint8Array(messagesBlob);
    if (options.messagesRawFile) {
      const messagesPath = resolve(options.messagesRawFile);
      await writeFile(messagesPath, messageBytes);
      log(`Wrote raw messages to ${messagesPath}`);
    }
    const decompressed = await lz4.decompress(messageBytes);
    const messages = JSON.parse(new TextDecoder().decode(decompressed));
    if (options.messagesFile) {
      const messagesPath = resolve(options.messagesFile);
      await writeFile(messagesPath, JSON.stringify(messages, null, 2));
      log(`Wrote messages to ${messagesPath}`);
    } else {
      // Write to stdout for piping
      console.log(JSON.stringify(messages, null, 2));
    }
  });

const program = new Command();

program.name('zapshot').description('ZapDev AI CLI').addCommand(generateCommand).addCommand(downloadCommand);

program.parse();
