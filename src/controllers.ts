/**
 * Types, Interfaces, and Decorators for endpoint controllers
 */

// ====================
// Types and Interfaces
// ====================

/**
 * Shape of Endpoint controller classes
 *
 * Though perhaps seemingly pointless, ControllerConstructor requires this, plus it helps ensure
 * consistency throughout the rest of this module.
 */
export interface Controller {}

/**
 * Type of endpoint controllers' `prefix` metadata
 */
type PrefixMetaData = string;

/**
 * Type of endpoint controllers' `routes` metadata
 */
type RoutesMetaData = Array<{ path: string; requestType: SupportedRequestTypes; methodName: string }>;

/**
 * Type of endpoint controller's combined metadata
 */
export type ControllerMetaData = {
  prefix: PrefixMetaData;
  routes: RoutesMetaData;
};

/**
 * Constructor type for endpoints controllers
 */
type ControllerConstructor = { new (...args: any[]): Controller };

/**
 * Type of Endpoint decorator
 *
 * Note: TypeScript's builtin ClassDecorator type is incorrect (see
 * https://github.com/Microsoft/TypeScript/issues/29828), so we compose our own, more specific
 * equivalents.
 */
type EndpointDecorator = <C extends ControllerConstructor>(target: C) => C | void;

/**
 * Type of Endpoint decorator factory
 */
type EndpointDecoratorFactory = (prefix: string) => EndpointDecorator;

/**
 * Union of supported HTTP request types
 *
 * Note: All lowercase, for use as index methods called on Express()
 */
type SupportedRequestTypes = 'get';

/**
 * Type of Route decorator
 */
type RouteDecorator = (target: any, methodName: string) => void;

/**
 * Type of Route decorator factory
 */
type RouteDecoratorFactory = (path: string, requestType: SupportedRequestTypes) => RouteDecorator;

/**
 * Type of Type of method-specific route decorator factory
 */
type RouteMethodDecoratorFactory = (path: string) => RouteDecorator;

// ================================
// Validate how decorators are used
// ================================

/**
 * Validate `path` param passed to route decorators, throw if invalid
 */
const validateDecoratorPath = (path: string, decoratorName: string) => {
  // @TODO Improve this naive regex
  //   It allows likely unintended patterns e.g. `/na:me`
  const validPattern = /^\/[a-z-:]+/;

  if (!path.match(validPattern)) {
    throw new Error(
      // @TODO also needs adjustment
      `@${decoratorName} decorator called with invalid \`path\` "${path}". It must begin with a slash, must contain at least one letter, and may only contain lowercase letters, slashes (-), and colons (:).`
    );
  }
};

/**
 * Validate `prefix` param passed to Endpoint decorator, throw if invalid
 */
const validateDecoratorPrefix = (prefix: string, decoratorName: string) => {
  // @TODO Improve this naive regex
  //   It allows likely unintended patterns e.g. `/hel/lo`
  const validPattern = /^\/[a-z-]+/;

  if (!prefix.match(validPattern)) {
    throw new Error(
      // @TODO also needs adjustment
      `@${decoratorName} decorator called with invalid \`prefix\` "${prefix}". It must begin with a slash, must contain at least one letter, and may only contain lowercase letters and slashes (-).`
    );
  }
};

// =========
// Utilities
// =========

/**
 * Ensure `routes` metadata initialized for decorated controller
 *
 * Only for use inside controller decorators. Allows any decorator call execution order.
 */
const ensureRoutesMetadataInitialized = (target: any): void => {
  if (!Reflect.hasMetadata('routes', target.constructor)) {
    const routes: RoutesMetaData = [];
    Reflect.defineMetadata('routes', routes, target.constructor);
  }
};

/**
 * Get reflection metadata for a decorated endpoint controller
 *
 * @param target {Controller} The decorated endpoint controller
 */
export const getControllerMetadata = (target: Controller): ControllerMetaData => {
  const prefix: PrefixMetaData = Reflect.getMetadata('prefix', target.constructor);
  const routes: RoutesMetaData = Reflect.getMetadata('routes', target.constructor);

  return { prefix, routes };
};

// ==============================
// Endpoint Controller Decorators
// ==============================

/**
 * Decorator factory to make a class into an endpoint controller
 *
 * @param prefix {string} - The endpoint prefix to serve (e.g. `/<prefix>/<path>`)
 */
export const Endpoint: EndpointDecoratorFactory = (prefix: string = ''): EndpointDecorator => {
  validateDecoratorPrefix(prefix, 'Endpoint');
  return (target: ControllerConstructor): void => {
    Reflect.defineMetadata('prefix', prefix, target);

    ensureRoutesMetadataInitialized(target);
  };
};

/**
 * Decorator factory to make a controller method a specific route handler
 *
 * For internal use only to compose HTTP request type-specific route decorators (e.g. GET), and thus
 * not exported.
 *
 * @param path {string} - The endpoint path to serve (e.g. `/<prefix>/<path>`)
 * @param requestType {SupportedRequestTypes} - HTTP request type to handle, lowercase
 */
const Route: RouteDecoratorFactory = (path: string, requestType: SupportedRequestTypes): RouteDecorator => {
  validateDecoratorPath(path, requestType.toUpperCase());
  // validate path
  return (target: any, methodName: string): void => {
    ensureRoutesMetadataInitialized(target);

    const routes: RoutesMetaData = Reflect.getMetadata('routes', target.constructor);

    routes.push({ path, requestType, methodName });

    Reflect.defineMetadata('routes', routes, target.constructor);
  };
};

/**
 * Decorator factory to make a controller method a GET request route handler
 * @param path
 * @constructor
 */
export const GET: RouteMethodDecoratorFactory = (path: string = '/'): RouteDecorator => {
  return (target, methodName: string): void => {
    Route(path, 'get')(target, methodName);
  };
};
