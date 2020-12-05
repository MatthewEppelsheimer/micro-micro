/**
 * Types, Interfaces, and Decorators for service controllers
 */
import { AvailableServices } from './services/';

const { defineMetadata, getMetadata, hasMetadata } = Reflect;

export type TaskId = number;

export interface Task {
  id: TaskId;
  service: string; // !!! may conflict w/ /services/index > ServiceName
  data: { [x: string]: any };
}

export type TaskResultStatus = 'done' | 'fail' | 'reject';

/**
 * Object with data resulting from processing a Task
 */
export class TaskResult {
  readonly id: TaskId;
  // Whether service finished, failed, or rejected the task
  readonly status: TaskResultStatus;
  readonly result: {
    // Issues, required in case of failure or rejection
    issues?: string[];
    // Service-specific results from task processing, required when finished
    data?: { [x: string]: any };
  };

  constructor(id: TaskId, status: TaskResultStatus, result?: { [x: string]: any }) {
    // @TODO validate based on status
    //   - if 'done', CAN'T have result.issues; MUST (good idea??) have result.data
    //   - if 'fail', MUST have result.issues; MAY have result.data
    //   - if 'reject', MUST have result.issues; CAN'T have result.data

    this.id = id;
    this.status = status;
    this.result = result || {};
  }
}

// decorator configuration
export type TaskServiceConfig = {
  name: string; // Unique name of the service
  description: string; // API user-facing description of provided service
  returnType: string | { [x: string]: any }; //
  requiredData?: { [x: string]: string }; // Data (params) required, if any
};

export abstract class TaskService {
  constructor() {
    this.#validateInstanceMetadata();
  }

  // service-specific task processing logic implementation
  protected abstract processTask: (task: Task) => Promise<TaskResult>;

  //
  // Get metadata added by @Service decorator
  //

  #getMetadataName = (): false | string => {
    return getMetadata('name', TaskService.constructor);
  };

  #getMetadataRequiredData = (): false | { [x: string]: string } => {
    return getMetadata('requiredData', TaskService.constructor);
  };

  // Require @Service decorator use at instantiation time
  #validateInstanceMetadata = (): void => {
    for (const key of ['name', 'description', 'returnType', 'requiredData']) {
      if (!hasMetadata(key, TaskService.constructor)) {
        throw new Error(`Class instance extending TaskService is missing metadata key ${key}.`);
      }
    }
  };

  /**
   * Confirm Task is meant for this service, and has id and required data
   */
  #validateTask = (task: Task): true | { taskIssues: string[] } => {
    const taskIssues: string[] = [];
    const thisService = this.#getMetadataName();
    const { id, data, service } = task;

    if (!id) {
      taskIssues.push(`Task missing id`);
    }

    if (service !== thisService) {
      taskIssues.push(`Task addressed to service ${service} sent to incorrect service ${thisService}`);
    }

    const requiredData = this.#getMetadataRequiredData();
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
    const { id } = task;

    return new Promise((resolve, reject) => {
      const taskValidation = this.#validateTask(task);
      if (taskValidation !== true) {
        resolve(new TaskResult(id, 'reject', { issues: taskValidation.taskIssues }));
      }

      try {
        return this.processTask(task);
      } catch (error) {
        return Promise.reject(new TaskResult(id, 'fail', { issues: `${error}` }));
      }
    });
  };
}

type TaskServiceConstructor = { new (...any: any[]): TaskService };

type TaskServiceDecorator = (target: TaskServiceConstructor) => void;

type TaskServiceDecoratorFactory = (config: TaskServiceConfig) => TaskServiceDecorator;

export const Service: TaskServiceDecoratorFactory = (config: TaskServiceConfig): TaskServiceDecorator => {
  return (target: TaskServiceConstructor): void => {
    const { name, description, returnType } = config;
    const requiredData = config.requiredData || false;

    // Invalidate decorator usage if any required config strings are empty
    if (!name || !description || !returnType) {
      throw new Error(`@Service decorator of ${target.name} passed invalid configuration.`);
    }

    defineMetadata('name', name, target);
    defineMetadata('description', description, target);
    defineMetadata('returnType', returnType, target);
    defineMetadata('requiredData', requiredData, target);
  };
};

export const getTaskServiceMetadata = (target: TaskService): TaskServiceConfig => {
  const name = Reflect.getMetadata('name', target.constructor);
  const description = Reflect.getMetadata('description', target.constructor);
  const returnType = Reflect.getMetadata('returnType', target.constructor);
  const requiredData = Reflect.getMetadata('requiredData', target.constructor);

  const metadata = {
    name,
    description,
    returnType
  };

  if (requiredData) {
    metadata.requiredData = requiredData;
  }

  return metadata;
};
