/**
 * BullMQ Interaction
 *
 * @TODO rename this file to designate it is queue connection-specific
 * @TODO If ever need to enqueue jobs somewhere other than IPServicesController,
 *       export an instantiated Queue for re-use.
 */
import { parse } from 'url';

import { QueueEvents } from 'bullmq';
import { Debugger } from 'debug';

import { TaskResult } from './taskServices';

// Build connection info from environment variables
const REDIS_URL = parse(process.env.REDIS_URL || 'http://127.0.0.1:6379');
const { port, hostname, auth } = REDIS_URL;

export const QUEUE = {
  CONFIG: {
    connection: {
      host: hostname || process.env.REDIS_HOST || 'localhost',
      port: Number(port) || Number(process.env.REDIS_PORT) || 6379,
      password: auth || process.env.REDIS_PASSWORD || 'pass',
      db: Number(process.env.REDIS_DB) || 0
    }
  },
  NAME: process.env.QUEUE_NAME || 'micro-micro'
};

/**
 * Instantiated QueueEvents singleton reference
 *
 *
 * QueueEvents' Redis connection is blocking. At least for now, likely forever, each process
 * can entirely re-use a single instance.
 */
let queueEventsInstance: QueueEvents;

/**
 * Return the QueueEvents singleton, instantiating if needed
 */
export const getQueueEvents = (): QueueEvents => {
  if (!queueEventsInstance) {
    queueEventsInstance = new QueueEvents(QUEUE.NAME, QUEUE.CONFIG);
  }

  return queueEventsInstance;
};

/*
  QueueEvent event types

  Bull's typing on the QueueEvents.on interface is incomplete/wrong for many/all event types
 */

export interface QueueEventCompleted {
  event: string;
  jobId: string;
  returnvalue: TaskResult;
}

/**
 * Debug queue events
 */
export const debugQueueEvents = (debug: Debugger, namespace: string = 'queue-events'): void => {
  ['waiting', 'delayed', 'progress', 'stalled', 'completed', 'failed', 'removed', 'drained'].forEach(eventType => {
    getQueueEvents().on(eventType, (...args: any) => {
      debug.extend(`${namespace}:${eventType}`)(`emitted with args: ${JSON.stringify({ ...args })}`);
    });
  });
};
