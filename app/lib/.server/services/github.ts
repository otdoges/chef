import { getEnv } from '../env';

export type GitHubRepoRef = {
  owner: string;
  name: string;
};

export type GitHubIssueSummary = {
  id: string;
  number: number;
  title: string;
  url: string;
  labels: string[];
  state: 'open' | 'closed';
};

export type PullRequestInput = {
  repo: GitHubRepoRef;
  title: string;
  head: string;
  base: string;
  body?: string;
  draft?: boolean;
};

export type PullRequestResult = {
  number: number;
  url: string;
  status: 'draft' | 'open';
};

export class GitHubService {
  constructor(private readonly installationToken: string) {}

  static fromEnv(): GitHubService {
    const token = getEnv('GITHUB_INSTALLATION_TOKEN');
    if (!token) {
      throw new Error('Missing GITHUB_INSTALLATION_TOKEN environment variable');
    }
    return new GitHubService(token);
  }

  async listOpenIssues(_repo: GitHubRepoRef): Promise<GitHubIssueSummary[]> {
    console.warn('GitHubService.listOpenIssues is not yet implemented');
    return [];
  }

  async fetchIssue(_repo: GitHubRepoRef, _issueNumber: number): Promise<GitHubIssueSummary | null> {
    console.warn('GitHubService.fetchIssue is not yet implemented');
    return null;
  }

  async createPullRequest(_input: PullRequestInput): Promise<PullRequestResult> {
    console.warn('GitHubService.createPullRequest is not yet implemented');
    return { number: -1, url: 'about:blank', status: 'draft' };
  }

  async updatePullRequest(_input: PullRequestInput & { number: number }): Promise<PullRequestResult> {
    console.warn('GitHubService.updatePullRequest is not yet implemented');
    return { number: _input.number, url: 'about:blank', status: 'open' };
  }
}

