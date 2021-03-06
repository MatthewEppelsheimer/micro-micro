/**
 * Worker process (Heroku "worker" process)
 *
 * Processes tasks from the job queue.
 *
 * NOTE the different levels of concurrency at work here:
 *   A. 2 Heroku processes: `web` & `worker`. Each scale independently.
 *      They map to server.ts` & worker.ts
 *   B. Within a single Heroku `worker` process, there can be multiple
 *      BullMQ.Worker objects processing the queue
 *   C. Node Clustering implemented with throng
 *
 * @TODO research whether "B" and "C" are redundant, performance-wise
 * @TODO review/standardize terminology of different concurrency levels
 *
 * @TODO handle redis connection issues
 *       (simulate by just killing redis dev server)
 */

import 'reflect-metadata';
import throng, { ProcessCallback } from 'throng';
import { Job, Worker } from 'bullmq';

import { getTaskServiceMetadata, Task, TaskResult, TaskService } from './taskServices';
import { QUEUE } from './shared';
import Debug from './debug';
import { AvailableServices } from './services';

const debug = Debug.extend(`queue-workers`);

// Load .env variables
if (process.env.USE_DOTENV) {
  require('dotenv').config();
}

// @TODO research/experiment with adjustments to these values
const QUEUE_WORKERS_PER_PROCESS =
  Number(process.env.WORKER_PROCESS_QUEUE_WORKERS_PER_PROCESS) || Number(process.env.QUEUE_WORKERS_PER_PROCESS) || 1;
const QUEUE_WORKER_MAX_JOBS =
  Number(process.env.WORKER_PROCESS_QUEUE_WORKER_MAX_JOBS) || Number(process.env.QUEUE_WORKER_MAX_JOBS) || 10;

// Shape of service name->instance map
type ServiceDirectory = { [x: string]: TaskService };

// Map of service names to their instances
// @TODO research: pros/cons to sharing this with all throngWorkers
const serviceInstances: ServiceDirectory = {};

AvailableServices.forEach(target => {
  const instance = new target();

  const { name } = getTaskServiceMetadata((target as unknown) as TaskService);

  serviceInstances[name] = instance;

  debug.extend('serviceInstances')(`added instance of ${name}`);
});

/**
 * Worker (Heroku process) routine
 */
const work = (throngWorkerId: Number) => {
  // Create a new queue worker & start it processing jobs
  const createWorker = (serial: Number): void => {
    const name = `${throngWorkerId}-${serial}`;

    const debugWorker = debug.extend(`queue:worker-${name}`);

    /**
     * Process a job from the queue
     *
     * This is passed a Job by the Queue
     */
    const processJob = async (job: Job): Promise<TaskResult> => {
      debugWorker(`processing job ${job.name}`);

      // Bull stores the task to Job.data
      const { data: task } = job;
      // const task = JSON.parse(data);

      const { serviceName } = task as Task;

      const service = serviceInstances[serviceName];

      if (!service) {
        throw new Error(`service '${service}' not found in serviceDirectory`);
      }

      debugWorker(`delegating job to ${serviceName} service: ${JSON.stringify(task)}`);

      // We need to return a Promise
      // 'await' here is just for debugging
      const result = await service.do(task);

      debugWorker(`returning job: ${JSON.stringify(result)}`);

      return Promise.resolve(result);
    };

    const concurrency = QUEUE_WORKER_MAX_JOBS;

    new Worker(QUEUE.NAME, processJob, { ...QUEUE.CONFIG, concurrency });
    debugWorker(`Worker created`);
  };

  // Create all workers for this process
  for (let i = 0; i < QUEUE_WORKERS_PER_PROCESS; i++) {
    createWorker(i);
  }
};

// =======================================
// Node Cluster Concurrency implementation
// =======================================

// @TODO DRY-up bits shared w/ server.js

const killSignals = ['SIGTERM', 'SIGINT'];
const debugThrong = debug.extend('throng');
// num cluster =threads, based on available CPUs (per env config)
const count = Number(process.env.WORKER_PROCESS_WEB_CONCURRENCY) || Number(process.env.WEB_CONCURRENCY) || 1;

/**
 * throng master process execution callback (debug output only)
 */
const master: ProcessCallback = () => {
  debugThrong.extend('master')(`starting with ${count} threads`);
};

/**
 * throng worker process execution callback
 *
 * Note: Type should be ProcessCallback but that's missing`disconnect` param.
 * @TODO investigate/report bug in ProcessCallback type
 */
const worker: any = (id: number, disconnect: () => void) => {
  const debugThread = debugThrong.extend(`worker-${id}`);
  debugThread(`starting`);

  // the business
  work(id);

  // Graceful process shutdown handler
  const shutdown = (code: number) => {
    debugThread(`shutting down with code ${code}`);
    disconnect();
  };

  // listen for process kill signals
  killSignals.forEach(signal => {
    // @TODO investigate/report bug in NodeJS.Process.once type
    // @ts-ignore - so signal can be more than just 'beforeExit'
    process.once(signal, shutdown);
  });
};

// Magic
throng({
  count,
  master,
  worker
});
