import * as braintrust from 'braintrust';
import { ZapDevResult } from './types.js';

export async function zapdevScorer(props: braintrust.EvalScorerArgs<string, ZapDevResult, void>) {
  return [
    {
      name: '1/Deploys',
      score: props.output.success ? 1 / Math.max(1, props.output.numDeploys) : 0,
    },
    { name: 'isSuccess', score: props.output.success ? 1 : 0 },
  ];
}
