import { Job } from "@/types";

const jobs = new Map<string, Job>();

export function getJob(jobId: string): Job | undefined {
  return jobs.get(jobId);
}

export function setJob(job: Job): void {
  jobs.set(job.jobId, job);
}

export function updateJob(jobId: string, updates: Partial<Job>): Job | undefined {
  const job = jobs.get(jobId);
  if (!job) return undefined;
  const updated = { ...job, ...updates };
  jobs.set(jobId, updated);
  return updated;
}

export function getAllJobs(): Job[] {
  return Array.from(jobs.values());
}
