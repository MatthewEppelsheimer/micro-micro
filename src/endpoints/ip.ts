/**
 * IP Address Services endpoint
 */
import { Request, Response } from 'express';
import { Queue } from 'bullmq';

import { QUEUE } from '../shared';
import { EndpointController, Endpoint, GET, RouteHandlerResponse } from '../controllers';
import { AvailableServiceName, AvailableServiceNames, DefaultServices } from '../services/';
import { registeredServices, RequestId, Task } from '../taskServices';
import RequestTaskBatchResolver from './ip/RequestTaskBatchResolver';
import { hashHex } from '../utils';

const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS) || 10000;

/**
 * Hello World endpoint controller
 */
@Endpoint('/ip')
export default class IPServicesController extends EndpointController {
  readonly #workQueue = new Queue(QUEUE.NAME, QUEUE.CONFIG);

  /**
   * Respond with API services available and instructions for their use
   *
   * @TODO implement
   */
  @GET('/')
  help = (_req: Request): RouteHandlerResponse => {
    return new RouteHandlerResponse(501, `"ip/" and "ip/help/" routes are not yet implemented`);
  };

  @GET('/:ip')
  doTasks = async (request: Request, response: Response): Promise<RouteHandlerResponse> => {
    const { domain, ip } = request.params;

    if (ip && !this.isIPValid(ip)) {
      return new RouteHandlerResponse(400, `The IP address provided with the request is invalid`);
    }

    if (domain && !this.isDomainValid(domain)) {
      return new RouteHandlerResponse(400, `The domain provided with the request is invalid`);
    }

    const { services } = request.body;

    // Validate services type
    if (services && typeof services !== 'string' && Array.isArray(services)) {
      return new RouteHandlerResponse(404, `request.body.services must be a string or an array.`);
    }

    let serviceTasks: AvailableServiceName[];

    // If no services requested, use default services
    if (!services) {
      serviceTasks = DefaultServices;
    }

    // If services requested, validate they are all available
    else {
      serviceTasks = Array.isArray(services)
        ? ((services as unknown) as AvailableServiceName[])
        : [(services as unknown) as AvailableServiceName];

      let invalidServices: string[] = [];
      serviceTasks.forEach(task => {
        if (!AvailableServiceNames.includes(task)) {
          invalidServices.push(task);
        }
      });
      if (invalidServices.length) {
        return new RouteHandlerResponse(404, `Requested services do not exist: ${invalidServices.toString()}`);
      }
    }

    // Validate request meets data requirements for services
    const requiredDataValidation = this.#validateRequestDataForServices(request, serviceTasks);
    if (requiredDataValidation !== true) {
      return requiredDataValidation;
    }

    // Terminology:
    // - One "Task" per service in HTTP request.body
    // - One "Request ID" per HTTP request, representing the tasks requested together as a batch

    // Generate Request ID to associate them tasks with their batch
    const requestId = hashHex(new Date().toISOString());

    // Send tasks to job queue, for workers on another process to consume
    const tasksToQueue: Task[] = [];
    serviceTasks.forEach((service, index) => {
      const id = hashHex(`${requestId}${index}`);

      const data = {
        ip
      };

      tasksToQueue.push({
        id,
        requestId: requestId,
        service,
        data
      });
    });

    /*
       1.0 default behavior is to wait for all services to resolve before sending response. In the
       future this will only happen when the request body includes `wait: true`, and the default
       will be to send a "pending" response with a URL to poll for results.
    */
    // const { wait } = request.body // <— future
    const wait = true;

    if (wait) {
      return await this.#waitForTasks(request, response, tasksToQueue, requestId);
    } else {
      // Just a shim for now
      return this.#startTasks(request, response, tasksToQueue);
    }
  };

  /**
   * Send an array of Tasks to the work queue
   */
  #queueTasks = (tasks: Task[]): void => {
    tasks.forEach(task => {
      const { id, data } = task;
      this.#workQueue.add(id, data);
    });
  };

  /**
   * Queue tasks and return a promise with their results
   *
   * @TODO catch & handle errors
   */
  #waitForTasks = async (
    request: Request,
    response: Response,
    tasks: Task[],
    requestId: RequestId
  ): Promise<RouteHandlerResponse> => {
    // Start listening to queue events BEFORE queuing tasks
    const resolver = new RequestTaskBatchResolver(
      {
        requestId,
        tasks
      },
      REQUEST_TIMEOUT_MS
    );

    // Now we can safely queue, knowing we won't miss any notifications
    this.#queueTasks(tasks);

    const results = await resolver.results();

    if (results.error) {
      const { code, message } = results.error;
      return new RouteHandlerResponse(code, message);
    }
    return new RouteHandlerResponse(200, results);
  };

  /**
   * Shim for future default behavior
   *
   * Send a "pending" response with URL to poll for results. A new counterpart '/job/:job' route
   * will provide results.
   *
   * @TODO implement
   */
  #startTasks = (_request: Request, _response: Response, _tasks: Task[]): Promise<RouteHandlerResponse> => {
    return Promise.resolve(new RouteHandlerResponse(500, `'wait' option not yet implemented`));
  };

  /**
   * Validate request includes data required by all requested service
   */
  #validateRequestDataForServices = (request: Request, serviceTasks: string[]): true | RouteHandlerResponse => {
    // Begin by building a requirements map from registered services
    let requirements: { [x: string]: { [x: string]: string[] } } = {};
    for (const requiredService of serviceTasks) {
      const registeredService = registeredServices.find(item => item.name === requiredService);
      if (!registeredService) {
        // The presence of this error node in the decision tree suggests we should be using
        // registeredServices exclusively, instead of in addition to AvailableServiceNames, above,
        // for simplicity. Throwing this in production is completely avoidable.
        // @TODO see note above
        throw new Error(
          `TaskService '${requiredService}' validated as available but not found in TaskService registry`
        );
      }

      const { name, requiredData } = registeredService;

      if (!requiredData) {
        continue;
      }

      // Build a map of required data keys, whose values are an array of shapes that services
      // expect. It's possible for different services to require a different shape from the same
      // key, so build a map of possible conflicts. It'll have the following shape:
      // ```
      // {
      //   /* keys at this level are required by services to exist in request.body. */
      //   id: {
      //     /* keys at this level represent expected type for the data. */
      //     string: [
      //        /* in this example, these two are compatible; they have the same expectation. */
      //       'someServiceName',
      //       'someOtherServiceName'
      //     ],
      //     /* ... but the key can't have both a string and a boolean shape */
      //     boolean: [ 'someConflictingService' ]
      //   },
      //  ... more keys ...
      // }
      // ```
      Object.keys(requiredData).forEach(key => {
        // e.g. { id: {} }
        requirements[key] = requirements[key] || {};
        // e.g. { id: { string: [] } }
        requirements[key][requiredData[key]] = requirements[key][requiredData[key]] || [];
        // e.g. { id: { string: [ 'someService' ] } }
        requirements[key][requiredData[key]].push(name);
      });
    }

    // We can't resolve any requirement conflicts present in the map we just built.
    // So, detect and report any conflicts to the user.
    const requirementConflicts: string[] = [];
    Object.keys(requirements).forEach(key => {
      if (Object.keys(key).length > 1) {
        // @TODO actually build strings describing each conflict for helpful output below
        requirementConflicts.push('issue'); // TEMP
      }
    });
    if (requirementConflicts.length) {
      // @TODO Use `issues` strings to be more helpful
      return new RouteHandlerResponse(
        400,
        `The services you've requested have different request body data requirements. To resolve this, send multiple requests, each with services that have compatible data requirements.`
      );
    }

    // Now validate that request.body data meets mapped requirements
    const providedKeys = (request.body.data && Object.keys(request.body.data)) || false;
    const missingDataIssues: string[] = [];
    Object.keys(requirements).forEach(key => {
      if (!providedKeys.includes(key)) {
        // @TODO improve this by naming the services
        missingDataIssues.push(`${key} is missing from your request body but is required for some requested services.`);
      } else {
        const providedType = typeof providedKeys[key];
        const requiredType = Object.keys(requirements[key])[0];
        if (providedType !== requiredType) {
          missingDataIssues.push(
            `${key} in your request body has type '${providedType}', but is required to have type '${requiredType}'.`
          );
        }
      }
    });
    if (missingDataIssues.length) {
      return new RouteHandlerResponse(400, `${missingDataIssues.join('\n ')}`);
    }

    return true;
  };
}
