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
import Debug from 'debug';

const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS) || 10000;

const debug = Debug('ip:endpoint');

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

  @GET('/:address')
  doTasks = async (request: Request, response: Response): Promise<RouteHandlerResponse> => {
    const debug = Debug('ip:endpoint:get-ip');

    const { address } = request.params;

    if (!address) {
      debug(`ipOrDomain param missing; returning 400`);
      return new RouteHandlerResponse(
        400,
        `/ip/<address> route requires passing a domain name or IP address, but none passed`
      );
    }

    let addressType: 'ip' | 'domain' | false = false;
    if (this.isIPValid(address)) {
      debug(`:address param validated as ip`);
      addressType = 'ip';
    } else if (this.isDomainValid(address)) {
      debug(`:address param validated as domain`);
      addressType = 'domain';
    }

    if (!addressType) {
      return new RouteHandlerResponse(
        400,
        `'address' parameter passed to /ip/<address> not a valid IP address or domain name`
      );
    }

    const ip = addressType === 'ip' ? address : false;
    // @TODO HIGH PRIORITY: ACT ON DOMAIN
    const domain = addressType === 'domain' ? address : false;

    const { services, data } = request.body;

    // Bundle validated request params with request body data
    const requestData = {
      ...data,
      ip,
      domain
    };

    debug(`request.body.services: ${services ? JSON.stringify(services) : 'none'}`);

    // Validate services type
    // @TODO review for proper sanitize
    if (services && typeof services !== 'string' && !Array.isArray(services)) {
      return new RouteHandlerResponse(404, `request.body.services must be a string or an array.`);
    }

    let serviceTasks: AvailableServiceName[];

    // If no services requested, use default services
    if (!services) {
      debug(`using default services: ${DefaultServices.toString()}`);
      serviceTasks = DefaultServices;
    }

    // If services requested, validate they are all available
    else {
      // convert to array
      serviceTasks = Array.isArray(services)
        ? ((services as unknown) as AvailableServiceName[])
        : [(services as unknown) as AvailableServiceName];

      debug(`user-requested services: ${services.toString()}`);

      let invalidServices: string[] = [];
      serviceTasks.forEach(task => {
        if (!AvailableServiceNames.includes(task)) {
          invalidServices.push(task);
        }
      });
      if (invalidServices.length) {
        const invalidString = invalidServices.toString();
        debug(`returning; requested services do not exist: ${invalidString}`);
        return new RouteHandlerResponse(404, `Requested services do not exist: ${invalidString}`);
      }
    }

    // Validate request meets data requirements for services
    const requiredDataValidation = this.#validateRequestDataForServices(requestData, serviceTasks);
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
        ip,
        domain
      };

      tasksToQueue.push({
        id,
        requestId: requestId,
        service,
        data
      });
    });

    debug(`tasksToQueue: ${JSON.stringify(tasksToQueue)}`);

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
    debug(`sending tasks to job queue`);
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
  #validateRequestDataForServices = (
    requestData: { [x: string]: any },
    serviceTasks: string[]
  ): true | RouteHandlerResponse => {
    const debug = Debug('ip:endpoint:validate-request-data-for-services');

    // Begin building a requirements map from registered services
    let requirements: { [x: string]: { [x: string]: string[] } } = {};
    // ... one required service at a time
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
    } // end for loop over required services

    debug(`requirements map: ${JSON.stringify(requirements)}`);

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
