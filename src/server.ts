/*
 * Server process
 *
 * Handles web connections and sends tasks to the job queue.
 */

import 'reflect-metadata';
import express from 'express';

import { getControllerMetadata } from './controllers';
import { HelloController, IPServicesController } from './endpoints';
import './services';

const PORT = process.env.PORT || 3000;

const app = express();

// Middleware to parse request body JSON
app.use(express.json());

const endpoints = [HelloController];

endpoints.forEach(endpointController => {
  const instance = new endpointController();

  const { prefix, routes } = getControllerMetadata(instance);

  routes.forEach(route => {
    const { path, requestType, methodName } = route;
    app[requestType](`${prefix}${path}`, (request, response) => {
      console.log(path, requestType, methodName);
      // @ts-ignore — `methodName: string` will be an index key of `instance`
      instance[methodName](request, response);
    });
  });
});

app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
