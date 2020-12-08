/**
 * Utility that handles a group of queued tasks as a single batch
 */

import Timeout = NodeJS.Timeout;
import { EventEmitter } from 'events';
import { QueueEvents } from 'bullmq';
import Debug from '../../debug';

import { RequestId, Task } from '../../taskServices';
import { QUEUE } from '../../shared';

// extension reflects subordination to IPServicesController
const debug = Debug.extend('ip:endpoint:request-batch-resolver');

/**
 * A batch of tasks with ID
 */
export interface TaskBatch {
  requestId: RequestId;
  tasks: Task[];
}

/**
 * An error returned from processing a TaskBatch
 */
export interface TaskBatchError {
  error: {
    code: 500 | 504;
    message: string;
  };
}

/**
 * A (non-error) result of processing a TaskBatch
 */
export interface TaskBatchResult {
  [x: string]: { [x: string]: any };
}

/**
 * lifecycle event type map
 */
const LIFECYCLE_EVENTS = {
  TIMEOUT: 'timeout',
  DONE: 'done'
};

/**
 * A utility class that owns a batch of pending job queue tasks
 *
 * This keeps track of its batch's pending tasks and their results when complete, and updates its
 * tasks' results on applicable QueueEvents. Calling .results() returns a promise with completed
 * tasks' data. Passing a timeout will resolve the promise with if an error if tasks take longer.
 */
export default class RequestTaskBatchResolver {
  /**
   * Job queue events reference
   */
  #queueEvents: QueueEvents;

  /**
   * Batch expiration timeout reference
   */
  readonly #timeout: Timeout;

  /**
   * Internal lifecyle event publisher
   *
   * Publishes:
   *   - "done" when the last task resolves
   *   - "timeout" when the batch expiration timeout elapses
   */
  readonly #lifecycle: EventEmitter = new EventEmitter();

  /**
   * Utility: Whether a jobId from the queue is in this batch
   *
   * Initialized in constructor, with TaskBatch available to get tasks' jobIds.
   */
  readonly #ownsTask: (jobId: string) => boolean;

  /**
   * Generator counting down by 1 from number of tasks in the batch as each completes
   *
   * Initialized in constructor, with TaskBatch available to get number of tasks.
   */
  readonly #pendingTaskCountDown: Generator<number>;

  /**
   * Store completed tasks' result data, keyed by their jobId
   */
  readonly #jobResults: TaskBatchResult = {};

  /**
   * Utility: Converts TaskBatchResults keys from jobId to service names
   */
  readonly #mapResultsToServiceNames: () => TaskBatchResult;

  /**
   * Create a resolver to manage a batch of tasks pending in the queue
   *
   * @param batch {TaskBatch} The batch of tasks
   * @param timeout {number}  Time allowed in milliseconds for all tasks to finish before resolving
   *                          with a failure
   */
  constructor(batch: TaskBatch, timeout: number) {
    debug(`new RequestTaskBatchResolver with batch: ${JSON.stringify(batch)}`);

    // Create job queue events emitter and store a reference to it
    this.#queueEvents = new QueueEvents(QUEUE.NAME, QUEUE.CONFIG);

    // Begin the timeout timer
    this.#timeout = setTimeout(() => {
      this.#lifecycle.emit(LIFECYCLE_EVENTS.TIMEOUT);
      // @TODO de-queue any still-pending tasks; avoid wasting resources processing abandoned tasks
    }, timeout);

    // Initialize ownsTask method with tasks from the batch
    this.#ownsTask = (jobId: string) => batch.tasks.some(task => task.id === jobId);

    // Build task results mapping from task jobId to associated service name from batch data
    this.#mapResultsToServiceNames = () => {
      const results: TaskBatchResult = {};
      batch.tasks.forEach(task => {
        const { id, service } = task;
        results[service] = this.#jobResults[id as keyof TaskBatchResult];
      });
      return results;
    };

    // Build pending task count down iterator from number of tasks in the batch
    this.#pendingTaskCountDown = (function* (tasksLeft: number) {
      while (tasksLeft) {
        tasksLeft--;
        yield tasksLeft;
      }
      return 0;
    })(batch.tasks.length);

    // Subscribe listeners to EventQueue events
    this.#queueEvents.on('completed', this.#eventListenerCompleted);

    ['failed', 'removed'].forEach(eventType => {
      this.#queueEvents.on(eventType, this.#eventListenerFailed);
    });

    // Debug events
    if (debug.enabled) {
      Object.keys(LIFECYCLE_EVENTS).forEach(eventType => {
        this.#lifecycle.prependListener(eventType, event => debug(`lifecycle emitted: ${event}`));
      });
    }
  }

  /**
   * Public accessor of resolved results as a promise
   */
  results = (): Promise<TaskBatchResult | TaskBatchError> => {
    return new Promise(resolve => {
      try {
        this.#lifecycle.once(LIFECYCLE_EVENTS.DONE, () => {
          clearTimeout(this.#timeout);
          resolve(this.#mapResultsToServiceNames());
          this.#cleanup();
        });

        this.#lifecycle.once(LIFECYCLE_EVENTS.TIMEOUT, () => {
          const error: TaskBatchError = {
            error: {
              code: 504,
              message: `One or more services timed out while processing the request.`
            }
          };

          resolve(error);
          this.#cleanup();
        });
      } catch (e) {
        console.log(e);
        return Promise.resolve({ error: { code: 500, error: `Unknown error while processing services` } });
      }
    });
  };

  /**
   * Handle queue task 'completed' events
   *
   * If the task is in this batch, store its result and decrement pending task count.
   */
  #eventListenerCompleted = (jobId: string, result: any): void => {
    if (!this.#ownsTask(jobId)) {
      return;
    }

    debug(`eventListenerCompleted() called with jobID: ${jobId} and result ${JSON.stringify(result)}`);

    this.#jobResults[jobId] = result;
    this.#decrementPendingTasks();
  };

  /**
   * Handle queue events indicating task failure
   *
   * If the task is in this batch, store an error for its result and decrement pending task count.
   * @param jobId
   */
  #eventListenerFailed = (jobId: string): void => {
    if (!this.#ownsTask(jobId)) {
      return;
    }

    debug(`eventListenerFailed() called with jobID: ${jobId}`);

    this.#jobResults[jobId] = { error: `Unknown service failure` };
    this.#decrementPendingTasks();
  };

  /**
   * Decrement pending tasks, and signal done if none remain
   */
  #decrementPendingTasks = (): void => {
    const tasksLeft = this.#pendingTaskCountDown.next();

    debug(`decrementPendingTasks() called. Tasks left: ${tasksLeft}`);

    if (tasksLeft.done) {
      //  Trigger 'done' lifecycle event if that was the last pending task
      this.#lifecycle.emit(LIFECYCLE_EVENTS.DONE);
    }
  };

  /**
   * Cleanup for garbage collection
   */
  #cleanup = () => {
    this.#queueEvents.close(); // stop queue event publishing
    this.#lifecycle.removeAllListeners(); // stop responding to lifecycle events
    this.#pendingTaskCountDown.return(0); // finish countdown generator
  };
}
