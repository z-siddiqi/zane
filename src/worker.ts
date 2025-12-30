import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Worker } from "bullmq";

import { fetchIssueWithParent } from "./lib/github";
import { upsertFeature, upsertFeatureTask } from "./db";
import { exists, safeRepoDir } from "./utils";
import { connection } from "./queue";

interface EnsureFeatureSpecJob {
  projectItemNodeId: string;
  contentNodeId: string;
  projectNodeId?: string;
  org?: string;
  from?: string;
  to?: string;
  changedAt?: string;
}

const worker = new Worker(
  "feature-pipeline",
  async (job) => {
    console.log(`[worker] processing job: ${job.id} (${job.name})`);
    
    if (job.name === "ENSURE_FEATURE_SPEC") {
      const data = job.data as EnsureFeatureSpecJob;

      const issue = await fetchIssueWithParent(data.contentNodeId);

      if (!issue) {
        throw new Error(`Issue not found: ${data.contentNodeId}`);
      }

      if (!issue.parent) {
        console.log(`[worker] Issue #${issue.number} has no parent, skipping`);
        return;
      }

      const repoFullName = issue.repository.nameWithOwner;
      const parentNumber = issue.parent.number;
      const parentTitle = issue.parent.title;
      const parentDescription = issue.parent.body || "";

      const dir = path.resolve(
        process.cwd(),
        process.env.FEATURES_DIR ?? "./features",
        safeRepoDir(repoFullName)
      );
      await mkdir(dir, { recursive: true });

      const mdPath = path.join(dir, `feature-${parentNumber}.md`);

      if (!(await exists(mdPath))) {
        await writeFile(mdPath, parentDescription, "utf8");
      }

      const featureKey = `${repoFullName}#${parentNumber}`;
      upsertFeature(
        featureKey,
        repoFullName,
        parentNumber,
        parentTitle ?? null,
        mdPath
      );

      // Link the child issue to the parent feature
      const featureKeyForTask = `${repoFullName}#${parentNumber}`;
      upsertFeatureTask(featureKeyForTask, issue.number, "active");

      return;
    }

    throw new Error(`Unknown job: ${job.name}`);
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
