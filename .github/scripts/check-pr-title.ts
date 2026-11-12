import type * as Core from '@actions/core';
import type { getOctokit, context } from '@actions/github';

type Context = typeof context;
type Octokit = ReturnType<typeof getOctokit>;

const MARKER = '<!-- pr-title-check -->';
const TITLE_REGEX = /^((chore|feat|fix|breaking|perf)(!)?|fixup\(#\d+\)):\s.+$/;

const WARNING_BODY = [
  MARKER,
  ":warning: Your PR title doesn't match the required format.",
  '',
  'The title should be in this format:',
  '',
  '```',
  'chore: update Text docs',
  'fix: text not rendering',
  'feat: add new feature to Text',
  'breaking: remove Text#resolution',
  'perf: faster addChild calls',
  'fixup(#123): rename Text#padding',
  '```',
  '',
  'Use `fixup(#<parent PR>)` for a PR stacked on another PR that must be reviewed before the parent merges.',
].join('\n');

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function minimizeComment(github: Octokit, core: typeof Core, nodeId: string) {
  try {
    await github.graphql(
      `mutation($id: ID!) {
              minimizeComment(input: { subjectId: $id, classifier: OUTDATED }) {
                minimizedComment { isMinimized }
              }
            }`,
      { id: nodeId },
    );
  } catch (error) {
    core.info(`Could not minimize comment ${nodeId}; ${getErrorMessage(error)}`);
  }
}

async function unminimizeComment(github: Octokit, core: typeof Core, nodeId: string) {
  try {
    await github.graphql(
      `mutation($id: ID!) {
              unminimizeComment(input: { subjectId: $id }) {
                unminimizedComment { isMinimized }
              }
            }`,
      { id: nodeId },
    );
  } catch (error) {
    core.info(`Could not unminimize comment ${nodeId}; ${getErrorMessage(error)}`);
  }
}

export default async ({ github, context, core }: { github: Octokit; context: Context; core: typeof Core }) => {
  const title = context.payload.pull_request?.title ?? '';
  const isValid = TITLE_REGEX.test(title);
  const isFork = !!context.payload.pull_request?.head?.repo?.fork;

  if (!isFork) {
    const owner = context.repo.owner;
    const repo = context.repo.repo;
    const issue_number = context.issue.number;

    const comments = await github.paginate(github.rest.issues.listComments, {
      owner,
      repo,
      issue_number,
      per_page: 100,
    });

    const botComments = comments.filter(
      (comment) => comment.user?.login === 'github-actions[bot]' && comment.body?.includes(MARKER),
    );

    const primaryComment = botComments[0];
    const duplicateComments = botComments.slice(1);

    for (const duplicateComment of duplicateComments) {
      if (duplicateComment.node_id) {
        await minimizeComment(github, core, duplicateComment.node_id);
      }
    }

    if (!isValid) {
      let activeComment;

      if (primaryComment) {
        const updatedComment = await github.rest.issues.updateComment({
          owner,
          repo,
          comment_id: primaryComment.id,
          body: WARNING_BODY,
        });

        activeComment = updatedComment.data;
      } else {
        const createdComment = await github.rest.issues.createComment({
          owner,
          repo,
          issue_number,
          body: WARNING_BODY,
        });

        activeComment = createdComment.data;
      }

      if (activeComment?.node_id) {
        await unminimizeComment(github, core, activeComment.node_id);
      }
    } else if (primaryComment?.node_id) {
      await minimizeComment(github, core, primaryComment.node_id);
    }
  }

  if (!isValid) {
    core.setFailed('PR title must start with one of: chore, feat, fix, breaking, perf, fixup(#<parent PR>).');
  }
};
