/**
 * Available TaskService lists and exports
 *
 * To add a service:
 *
 * 1. Add a new @Service-decorated TaskService in this directory
 * 2. import the new TaskService here
 * 3. export the new TaskService from here, at end of file
 * 4. add its class to `AvailableServices` array below
 * 5. add its 'name' to `AvailableServiceNames` array below (same as
 *    config.name passed to @Service in step 1)
 * 5. Add it to `defaultServicesString` below, if it belongs there
 */
import IPValidationService from './ip-validation';
import JobWorkerMock from './job-worker-mock';
import { TaskService } from '../taskServices';
import { Concrete } from '../utils';

const DEFAULT_SERVICES_CONFIG = process.env.DEFAULT_SERVICES || false;

/**
 * Available Services
 */
export const AvailableServices: Concrete<TaskService>[] = [IPValidationService, JobWorkerMock];

/**
 * Available Service Names
 *
 * (TypeScript const assertion coerces its type to literal identity.)
 *
 * @TODO at the very least, build this & AvailableServices from a map. One place to update.
 * @TODO maybe build procedurally from meta-reflection to obviate manual editing
 */
export const AvailableServiceNames = ['ip-validation', 'mock-worker'] as const;

/**
 * Type a value to be an Available Service's name
 *
 * @TODO review whether this is a useful export
 */
export type AvailableServiceName = typeof AvailableServiceNames[number];

const defaultServices = DEFAULT_SERVICES_CONFIG ? DEFAULT_SERVICES_CONFIG.split(',') : AvailableServiceNames;

/**
 * Services to use by default when a request doesn't specify any
 *
 * Built up from env var with comma-separated list above, enforcing only
 * including Available Services. Default to all registered services if
 * none configured.
 */
export const DefaultServices: Array<AvailableServiceName> = (defaultServices as Array<AvailableServiceName>).filter(
  val => AvailableServiceNames.includes(val as AvailableServiceName)
);

// Services
export { IPValidationService, JobWorkerMock };
