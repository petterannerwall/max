import * as schedule from "node-schedule";
import { listScheduledTasks } from "./store/db.js";
import { sendToOrchestrator, proactiveNotify } from "./copilot/orchestrator.js";

const activeJobs = new Map<number, schedule.Job>();

export function startScheduler(): void {
  reloadScheduler();
}

export function reloadScheduler(): void {
  // Cancel all existing jobs
  for (const job of activeJobs.values()) {
    job.cancel();
  }
  activeJobs.clear();

  const tasks = listScheduledTasks();
  for (const task of tasks) {
    if (!task.enabled) continue;
    try {
      const job = schedule.scheduleJob(
        { rule: task.cron, tz: task.timezone },
        () => {
          sendToOrchestrator(task.prompt, { type: "background" }, (_text, done) => {
            if (done) proactiveNotify(_text);
          }).catch((err) => {
            console.error(`[scheduler] Task "${task.name}" (id=${task.id}) failed:`, err);
          });
        }
      );
      if (job) {
        activeJobs.set(task.id, job);
        const next = job.nextInvocation();
        console.log(`[max] scheduler "${task.name}" next run: ${next?.toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' })} Stockholm`);
      }
    } catch (err) {
      console.error(`[max] scheduler failed to schedule "${task.name}" (id=${task.id}):`, err);
    }
  }

  console.log(`[max] scheduler ${activeJobs.size} task(s) scheduled`);
}

export function getNextRunTime(taskId: number): Date | null {
  const job = activeJobs.get(taskId);
  if (!job) return null;
  return job.nextInvocation();
}

export function getActiveJobIds(): number[] {
  return Array.from(activeJobs.keys());
}
