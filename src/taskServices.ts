/**
 * Types, Interfaces, and Decorators for service controllers
 *
 * @TODO reorganize:
 *       - split server/worker shared interfaces out into shared territory
 *       - keep decorators here, rename appropriately
 */
const { defineMetadata, getMetadata, hasMetadata } = Reflect;

import Debug from './debug';

const debug = Debug.extend('service');

export type TaskId = string;

export type RequestId = string;

export interface Task {
  id: TaskId;
  requestId: RequestId;
  serviceName: string;
  data: { [x: string]: any };
}

export const TaskResultStatuses = ['done', 'fail', 'reject'];
export type TaskResultStatus = 'done' | 'fail' | 'reject';

/**
 * Object with data resulting from processing a Task
 */
export class TaskResult {
  readonly id: TaskId;
  readonly requestId: RequestId;
  // Whether service finished, failed, or rejected the task
  readonly status: TaskResultStatus;
  readonly resultData: {
    // Issues, required in case of failure or rejection
    issues?: string[];
    // Service-specific results from task processing, required when finished
    data?: { [x: string]: any };
  };

  constructor(id: TaskId, requestId: RequestId, status: TaskResultStatus, result?: { [x: string]: any }) {
    // @TODO validate based on status
    //   - if 'done', CAN'T have result.issues; MUST (good idea??) have result.data
    //   - if 'fail', MUST have result.issues; MAY have result.data
    //   - if 'reject', MUST have result.issues; CAN'T have result.data

    this.id = id;
    this.requestId = requestId;
    this.status = status;
    this.resultData = result || {};
  }
}

// decorator configuration
export type TaskServiceConfig = {
  name: string; // Unique name of the service
  description: string; // API user-facing description of provided service
  returnType: string | { [x: string]: any }; //
  requiredData?: { [x: string]: any }; // Data (params) required, if any
};

export abstract class TaskService {
  constructor() {
    this.validateInstanceMetadata();
    debug.extend(this.getMetadataName() || 'unnamed')(`instantiated`);
  }

  // service-specific task processing logic implementation
  protected abstract processTask: (task: Task) => Promise<TaskResult>;

  //
  // Get metadata added by @Service decorator
  //

  protected getMetadataName = (): false | string => {
    return getMetadata('name', TaskService.constructor);
  };

  protected getMetadataRequiredData = (): false | { [x: string]: string } => {
    return getMetadata('requiredData', TaskService.constructor);
  };

  // Require @Service decorator use at instantiation time
  protected validateInstanceMetadata = (): void => {
    for (const key of ['name', 'description', 'returnType', 'requiredData']) {
      if (!hasMetadata(key, TaskService.constructor)) {
        throw new Error(`Class instance extending TaskService is missing metadata key ${key}.`);
      }
    }
  };

  /**
   * Confirm Task is meant for this service, and has id and required data
   */
  protected validateTask = (task: Task): true | { taskIssues: string[] } => {
    const taskIssues: string[] = [];
    const thisService = this.getMetadataName();
    const { id, data, requestId, serviceName } = task;

    if (!id) {
      taskIssues.push(`Task missing id`);
    }

    if (!requestId) {
      taskIssues.push(`Task missing requestId`);
    }

    if (serviceName !== thisService) {
      taskIssues.push(`Task addressed to service ${serviceName} sent to incorrect service ${thisService}`);
    }

    const requiredData = this.getMetadataRequiredData();
    if (requiredData) {
      for (const key in requiredData) {
        if (!data[key]) {
          taskIssues.push(`Task missing \`${key}\` data required by ${thisService}`);
        }
      }
    }

    return taskIssues.length ? { taskIssues } : true;
  };

  // Receive tasks to process from workers, return a Promise with the result
  public do = (task: Task): Promise<TaskResult> => {
    const debugService = debug.extend(this.getMetadataName() || 'unnamed');
    debugService(`handling task: ${JSON.stringify(task)}`);

    const { id, requestId } = task;

    return new Promise(resolve => {
      const taskValidation = this.validateTask(task);
      if (taskValidation !== true) {
        debugService(`failed validation for task id ${id}`);
        resolve(new TaskResult(id, requestId, 'reject', { issues: taskValidation.taskIssues }));
      }

      this.processTask(task).then(result => {
        debugService(`promise resolving with result: ${JSON.stringify(result)}`);

        resolve(result);
        return result;
      });
    });
  };
}

type TaskServiceConstructor = { new (...any: any[]): TaskService };

type TaskServiceDecorator = <C extends TaskServiceConstructor>(target: C) => C | void;

type TaskServiceDecoratorFactory = (config: TaskServiceConfig) => TaskServiceDecorator;

export const registeredServices: Array<{ name: string; description: string; requiredData?: { [x: string]: any } }> = [];

export const Service: TaskServiceDecoratorFactory = (config: TaskServiceConfig): TaskServiceDecorator => {
  return (target: TaskServiceConstructor): void => {
    const { name, description, requiredData, returnType } = config;

    // Invalidate decorator usage if any required config strings are empty
    if (!name || !description || !returnType) {
      throw new Error(`@Service decorator of ${target.name} passed invalid configuration.`);
    }

    // Store class constructor metadata
    defineMetadata('name', name, target.constructor);
    defineMetadata('description', description, target.constructor);
    defineMetadata('returnType', returnType, target.constructor);
    defineMetadata('requiredData', requiredData, target.constructor);

    // Register service
    registeredServices.push({
      name,
      description,
      requiredData
    });
  };
};

/**
 * Get metadata for a TaskService
 */
export const getTaskServiceMetadata = (target: TaskService): TaskServiceConfig => {
  const name = getMetadata('name', target.constructor);
  const description = getMetadata('description', target.constructor);
  const returnType = getMetadata('returnType', target.constructor);
  const requiredData = getMetadata('requiredData', target.constructor);

  const metadata = {
    name,
    description,
    returnType,
    requiredData: undefined
  };

  if (requiredData) {
    metadata.requiredData = requiredData;
  }

  return metadata;
};
