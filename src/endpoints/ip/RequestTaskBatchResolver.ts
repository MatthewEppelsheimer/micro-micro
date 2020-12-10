/**
 * Utility that handles a group of queued tasks as a single batch
 */

import Timeout = NodeJS.Timeout;
import { EventEmitter } from 'events';
import Debug from '../../debug';

import { RequestId, Task, TaskResultStatus } from '../../taskServices';
import { QueueEventCompleted, getQueueEvents } from '../../shared';

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
  services: {
    [x: string]: {
      id: string; // task ID
      status: TaskResultStatus;
      result: {
        data?: any;
        error?: any;
      };
    };
  };
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
 * tasks' data. Passing a timeout will resolve the promise with an error if tasks take longer.
 */
export default class RequestTaskBatchResolver {
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
  readonly #ownsTask: (eventData: QueueEventCompleted) => boolean;

  /**
   * Generator counting down by 1 from number of tasks in the batch as each completes
   *
   * Initialized in constructor, with TaskBatch available to get number of tasks.
   */
  readonly #pendingTaskCountDown: Generator<number>;

  /**
   * Store completed tasks' result data, keyed by their jobId
   */
  readonly #jobResults: { [x: string]: any } = {};

  /**
   * Utility: Converts TaskBatchResults keys from jobId to service names
   */
  readonly #mapResultsToServiceNames: () => TaskBatchResult;

  /**
   * Create a resolver to manage a batch of tasks pending in the queue
   *
   * @param batch {TaskBatch} The batch of tasks
   * @param timeout {number}  Time allowed in milliseconds for all tasks to finish before resolving
   *                          with a failure. Defaults to 10,000 (10s).
   */
  constructor(batch: TaskBatch, timeout: number = 10000) {
    debug(`instantiating with batch: ${JSON.stringify(batch)}`);

    // Begin the timeout timer
    this.#timeout = setTimeout(() => {
      this.#lifecycle.emit(LIFECYCLE_EVENTS.TIMEOUT);
      // @TODO de-queue any still-pending tasks; avoid wasting resources processing abandoned tasks
    }, timeout);

    // Initialize ownsTask method with tasks from the batch
    // @TODO ensure this works for all event types' shape
    this.#ownsTask = (eventData: QueueEventCompleted) => batch.requestId === eventData.returnvalue.requestId;

    // Build task results mapping from task jobId to associated service name from batch data
    this.#mapResultsToServiceNames = () => {
      const results: TaskBatchResult = { services: {} };
      batch.tasks.forEach(task => {
        const { id, serviceName } = task;
        const rawData = this.#jobResults[id as keyof TaskBatchResult];
        const { status, resultData } = rawData;

        results.services[serviceName] = {
          id,
          status,
          result: resultData
        };
      });
      return results;
    };

    // Build pending task count-down generator from number of tasks in the batch
    this.#pendingTaskCountDown = (function* (tasksLeft: number) {
      while (tasksLeft) {
        tasksLeft--;
        if (tasksLeft === 0) {
          return 0;
        } else {
          yield tasksLeft;
        }
      }
    })(batch.tasks.length);

    // Subscribe listeners to EventQueue events
    const queueEvents = getQueueEvents();

    queueEvents.on('completed', this.#eventListenerCompleted);

    ['failed', 'removed'].forEach(eventType => {
      queueEvents.on(eventType, this.#eventListenerFailed);
    });

    // Debug resolver lifecyle events
    if (debug.enabled) {
      // Debug namespace: `micro-micro:ip:endpoint:request-batch-resolver`
      Object.keys(LIFECYCLE_EVENTS).forEach(eventType => {
        this.#lifecycle.prependListener(eventType, event => debug(`lifecycle emitted: ${event}`));
      });
    }
  }

  /**
   * Public accessor to get batch results as a Promise
   */
  results = (): Promise<TaskBatchResult | TaskBatchError> => {
    return new Promise(resolve => {
      try {
        this.#lifecycle.once(LIFECYCLE_EVENTS.DONE, () => {
          clearTimeout(this.#timeout);
          resolve(this.#mapResultsToServiceNames());
          this.#close();
        });

        this.#lifecycle.once(LIFECYCLE_EVENTS.TIMEOUT, () => {
          const error: TaskBatchError = {
            error: {
              code: 504,
              message: `One or more services timed out while processing the request.`
            }
          };

          resolve(error);
          this.#close();
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
   * @TODO catch errors
   *
   * If the task is in this batch, store its result and decrement pending task count.
   */
  #eventListenerCompleted = (eventData: QueueEventCompleted, ...args: any): void => {
    debug.extend('event-listener-completed')(`passed args: ${JSON.stringify({ eventData, ...args })}`);

    if (!this.#ownsTask(eventData)) {
      return;
    }

    const { returnvalue } = eventData;
    const { id } = returnvalue;

    debug.extend('event-listener-completed')(`job ${id}`);

    this.#jobResults[id] = returnvalue;
    this.#decrementPendingTasks();
  };

  /**
   * Handle queue events indicating task failure
   *
   * If the task is in this batch, store an error for its result and decrement pending task count.
   *
   * @TODO catch errors
   */
  #eventListenerFailed = (eventData: QueueEventCompleted, ...args: any): void => {
    // @TODO re-implement
  };

  /**
   * Decrement pending tasks, and signal done if none remain
   */
  #decrementPendingTasks = (): void => {
    const tasksLeft = this.#pendingTaskCountDown.next();

    debug.extend('decrementPendingTasks')(`Tasks left: ${tasksLeft.value}`);

    // @TODO error handle when (value !==0 && done) — emit 'fail' instead
    if (tasksLeft.value === 0 || tasksLeft.done) {
      //  Trigger 'done' lifecycle event
      this.#lifecycle.emit(LIFECYCLE_EVENTS.DONE);
    }
  };

  /**
   * Free up references for garbage collection
   *
   * setTimeout 0ms to allow all listeners to respond to final messages.
   */
  #close = () => {
    setTimeout(() => {
      debug(`cleaning up`);

      // stop listening to our own lifecycle events
      this.#lifecycle.removeAllListeners();

      // Stop listening to shared QueueEvents
      const queueEvents = getQueueEvents();
      queueEvents.removeListener('completed', this.#eventListenerCompleted);
      ['failed', 'removed'].forEach(eventType => {
        queueEvents.removeListener(eventType, this.#eventListenerFailed);
      });

      // finish countdown generator
      // @TODO Is this needed? Effective? What happens to still-referenced, unfinished generators?
      this.#pendingTaskCountDown.return(0);
    }, 0);
  };
}
