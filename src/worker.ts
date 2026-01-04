import { Worker } from "bullmq";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { RunTaskJob } from "./types";
import { fetchIssueWithParent, fetchIssueByNumber } from "./lib/github";
import { sanitizeMarkdown } from "./lib/markdown";
import { OpenCodeInstance, waitForCompletion } from "./lib/opencode";
import { slugify } from "./utils";
import { connection, queue } from "./queue";

const REQUEUE_DELAY_MS = 30000;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? "";
const LOCAL_REPO_PATH = process.env.LOCAL_REPO_PATH ?? "";

const worker = new Worker(
  "feature-pipeline",
  async (job) => {
    console.log(`[worker] processing: ${job.id}`);
    if (job.name !== "RUN_TASK") throw new Error(`Unknown job: ${job.name}`);

    const { issueNodeId } = job.data as RunTaskJob;
    const issue = await fetchIssueWithParent(issueNodeId);
    if (!issue) throw new Error(`Issue not found: ${issueNodeId}`);

    if (!issue.parent) {
      console.log(`[worker] Issue #${issue.number} no parent, re-queuing`);
      await queue.add("RUN_TASK", { issueNodeId } as RunTaskJob, {
        jobId: `task-${issueNodeId}-${Date.now()}`,
        delay: REQUEUE_DELAY_MS,
        attempts: 2,
        backoff: { type: "exponential", delay: 5000 },
      });
      return;
    }

    const parent = await fetchIssueByNumber(issue.repository.nameWithOwner, issue.parent.number);
    if (!parent) throw new Error(`Parent #${issue.parent.number} not found`);

    const taskDir = path.join(LOCAL_REPO_PATH, ".tasks", `task-${issue.number}`);
    const headers = { Authorization: `Bearer ${GITHUB_TOKEN}` };

    const [epicBody, taskBody] = await Promise.all([
      sanitizeMarkdown(taskDir, parent.body || "", { headers }),
      sanitizeMarkdown(taskDir, issue.body || "", { headers }),
    ]);

    const branch = `ai/task-${issue.number}-${slugify(issue.title)}`;
    const prompt = `# Task: ${issue.title}

## Epic: ${parent.title} (#${parent.number})
${epicBody}

## Task Details
**Issue #${issue.number}**
${taskBody}

## Instructions
1. Create and checkout branch: \`${branch}\`
2. Implement the task (keep diff small, follow existing patterns)
3. Check \`git log --oneline -10\` and commit matching that style
`;

    const promptPath = path.join(taskDir, "task.md");
    await mkdir(taskDir, { recursive: true });
    await writeFile(promptPath, prompt, "utf8");

    console.log(`[worker] executing task #${issue.number}`);
  
    const instance = await OpenCodeInstance.spawn(LOCAL_REPO_PATH);
  
    try {
      const session = await instance.createSession(`Task: ${path.basename(promptPath)}`);
      console.log(`[opencode:${instance.port}] Session: ${session.id}`);
  
      await instance.sendPromptAsync(session.id, await readFile(promptPath, "utf-8"), {
        model: { providerID: "anthropic", modelID: "claude-opus-4-5" },
      });
      console.log(`[opencode:${instance.port}] Prompt sent, listening for events...`);
  
      await waitForCompletion(instance, session.id, 600000);
    } finally {
      instance.close();
    }

    console.log(`[worker] completed task #${issue.number}`);
  },
  {
    connection,
    concurrency: 1,
    lockDuration: 600000,
    maxStalledCount: 2,
    stalledInterval: 30000,
  }
);

worker.on("completed", (job) => console.log(`[worker] done: ${job.id}`));
worker.on("failed", (job, err) => console.error(`[worker] failed: ${job?.id} - ${err.message}`));

console.log("[worker] listening");
