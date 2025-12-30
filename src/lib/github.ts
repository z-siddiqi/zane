const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? "";

export async function fetchIssueWithParent(issueNodeId: string) {
  const query = `
      query($nodeId: ID!) {
        node(id: $nodeId) {
          ... on Issue {
            number
            title
            body
            repository {
              nameWithOwner
            }
            parent: parent {
              ... on Issue {
                number
                title
                body
              }
            }
          }
        }
      }
    `;

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables: { nodeId: issueNodeId },
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  const result = (await response.json()) as {
    data?: { node?: any };
    errors?: Array<{ message: string }>;
  };
  if (result.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
  }

  return result.data?.node;
}
