/*
 * Server process
 *
 * Handles web connections and sends tasks to the job queue.
 */

import 'reflect-metadata';
import express, { Request, Response } from 'express';

import { getControllerMetadata } from './controllers';
import { HelloController, IPServicesController } from './endpoints';
import './services';

const PORT = process.env.PORT || 3000;

const app = express();

// Middleware to parse request body JSON
app.use(express.json());

const endpoints = [HelloController, IPServicesController];

endpoints.forEach(endpointController => {
  const instance = new endpointController();

  const { prefix, routes } = getControllerMetadata(instance);

  routes.forEach(route => {
    const { path, requestType, methodName } = route;
    // @TODO sanitize request.body members ip, domain, and data
    // @TODO sanitize input dynamically based registered services' expectations
    app[requestType](`${prefix}${path}`, async (request: Request, response: Response) => {
      // @TODO remove this ts-ignore with index typing
      // @ts-ignore — `methodName: string` will be an index key of `instance`
      const result = await instance[methodName](request, response);

      // @TODO either use RouteHandlerResponse.error or remove it
      const { data, statusCode } = result;
      response.status(statusCode).send(data);
    });
  });
});

app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
