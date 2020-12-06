/**
 * Available TaskService lists and exports
 *
 * To add a service:
 *
 * - Add a new @Service-decorated TaskService in this directory
 * - import the new TaskService here
 * - export the new TaskService from here, at end of file
 * - add its name the `AvailableServices` array under imports, below
 * - Add it to `defaultServicesString` below, if it belongs there
 */
import IPValidationService from './ip-validation';

/**
 * Available Services
 */
export const AvailableServices = [IPValidationService];

/**
 * Available Service Names
 *
 * (TypeScript const assertion coerces its type to literal identity.)
 *
 * @TODO maybe build procedurally from meta-reflection to obviate manual editing
 */
export const AvailableServiceNames = ['ip-validation'] as const;

/**
 * Type a value to be an Available Service's name
 *
 * @TODO review whether this is a useful export
 */
export type AvailableServiceName = typeof AvailableServiceNames[number];

const defaultServicesString = process.env.DEFAULT_SERVICES || 'ip-validation';
const defaultServicesArray = defaultServicesString.split(',');

/**
 * Services to use by default when a request doesn't specify any
 *
 * Built up from env var with comma-separated list above, enforcing only
 * including Available Services.
 */
export const DefaultServices: Array<AvailableServiceName> = (defaultServicesArray as Array<AvailableServiceName>).filter(
  val => AvailableServiceNames.includes(val as AvailableServiceName)
);

// Services
export { IPValidationService };
