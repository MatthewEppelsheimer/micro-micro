/*
 * Server process (Heroku "web" process)
 *
 * Handles web connections and sends tasks to the job queue.
 * Uses Node clustering for concurrency (`throng` abstraction).
 */

import 'reflect-metadata';
import express, { Request, Response } from 'express';
import throng, { ProcessCallback } from 'throng';

import { EndpointController, getControllerMetadata } from './controllers';
import { HelloController, IPServicesController } from './endpoints';
import { debugQueueEvents, getQueueEvents } from './shared';
import { Concrete } from './utils';

import Debug from './debug';
const debug = Debug.extend(`server`);

// Load .env variables
if (process.env.USE_DOTENV) {
  require('dotenv').config();
}

// Server port to listen on, from environment variable
const PORT = Number(process.env.PORT) || 3000;

/**
 * Server routine
 */
const serve = (workerId: Number) => {
  // Create the Queue Events singleton to ready it for endpoints
  getQueueEvents();

  const debugServe = debug.extend(`worker-${workerId}`);
  const app = express();

  // Middleware to parse request body JSON
  app.use(express.json());

  // @TODO move this to an export of endpoints/index.ts
  const endpoints: Concrete<EndpointController>[] = [HelloController, IPServicesController];

  endpoints.forEach(endpointController => {
    const instance = new endpointController();

    const { prefix, routes } = getControllerMetadata(instance);

    routes.forEach(route => {
      const { path, requestType, methodName } = route;
      // @TODO sanitize request.body members ip, domain, and data
      // @TODO sanitize input dynamically based registered services' expectations
      app[requestType](`${prefix}${path}`, async (request: Request, response: Response) => {
        // @TODO replace this ts-ignore with index typing
        // @ts-ignore — `methodName: string` will be an index key of `instance`
        const result = await instance[methodName](request, response);

        // @TODO either use RouteHandlerResponse.error or remove it
        const { data, statusCode } = result;

        debugServe(`sending ${statusCode} response with data: ${JSON.stringify(data)}`);

        response.status(statusCode).send(data);
      });
    });
  });

  app.listen(PORT, () => {
    console.log(`Express: throng-${workerId} listening on port ${PORT}`);
  });
};

// ==========================
// Concurrency implementation
// ==========================

const killSignals = ['SIGTERM', 'SIGINT'];
const debugThrong = debug.extend('throng');
// num workers/threads, based on available CPUs (per env config)
const count = Number(process.env.SERVER_PROCESS_WEB_CONCURRENCY) || Number(process.env.WEB_CONCURRENCY) || 1;

/**
 * throng master process execution callback (debug output only)
 */
const master: ProcessCallback = () => {
  debugThrong.extend('master')(`starting with ${count} threads`);

  // Debug QueueEvent events
  // @NOTE This is only in the master process, to avoid duplicate output for each throng worker
  //       — But see counterpart in `worker()`
  // Intentionally NOT using debugThrong here
  // Debug namespace: `micro-micro:server:queue-events:*`
  debugQueueEvents(debug);
};

/**
 * throng worker process execution callback
 *
 * Note: Type should be ProcessCallback but that's missing`disconnect` param.
 * @TODO investigate/report bug in ProcessCallback type
 */
const worker: any = (id: number, disconnect: () => void) => {
  const debugWorker = debugThrong.extend(`worker-${id}`);
  debugWorker(`starting`);

  // Debug QueueEvent events
  // @NOTE For debugging individual workers — maybe think of counterpart in `master()` as a global
  if (debugWorker.enabled) {
    // Debug namespace: `micro-micro:server:throng:worker-${id}:worker-queue-events:*`
    debugQueueEvents(debugWorker);
  }

  // the business
  serve(id);

  // Graceful process shutdown handler
  const shutdown = (code: number) => {
    debugWorker(`shutting down with code ${code}`);
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
