import { anthropic } from '@ai-sdk/anthropic';
import { zapdevTask } from './zapdevTask.js';
import { ZapDevModel } from './types.js';
import { mkdirSync } from 'fs';
import { zapdevSetLogLevel } from 'zapdev-agent/utils/logger.js';

zapdevSetLogLevel('info');

const model: ZapDevModel = {
  name: 'claude-4-sonnet',
  model_slug: 'claude-sonnet-4-20250514',
  ai: anthropic('claude-sonnet-4-20250514'),
  maxTokens: 16384,
};
mkdirSync('/tmp/backend', { recursive: true });
const result = await zapdevTask(model, '/tmp/backend', 'Make me a chat app');
console.log(result);
