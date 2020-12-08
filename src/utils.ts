import { createHash } from 'crypto';

/**
 * Express the type of a instantiatable class that extends an abstract
 *
 * Usage: Treat this as a function, passing an abstract class name as T.
 *
 * - Whenever `RegularClass` is not an abstract class,
 * - then `RegularClass: typeof SomeAbstract; new RegularClass()` won't work,
 * - but `RegularClass: Concrete<SomeAbstract>; new RegularClass()` WILL work.
 *
 * Why? Occasionally you need to represent a collection of that constructed instances that inherit
 * from an abstract class. This happens frequently when using the pattern of metadata-decorating
 * classes that extend an abstract with metadata interaction — like TaskService and
 * EndpointControllers in this project. Since abstracts can't be constructed, using
 * `typeof SomeAbstract[]` won't allow you to call `new` on any of the new-able instances.
 * Frustrating. This is a workaround from Angular, which exports it as `Type`. Here it's renamed
 * for our use case.
 *
 * @see https://github.com/Microsoft/TypeScript/issues/5843
 * @see https://stackoverflow.com/questions/39909015/what-is-type-in-angular-2
 */

export interface Concrete<T> {
  new (...args: any[]): T;
}

/**
 * Check whether a string is a valid IPv4 address
 */
export const isIPValid = (ip: string): boolean => !!ip.match(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/);

/**
 * *NAIVE* domain address validation
 *
 * @TODO make this much better
 */
export const isDomainValid = (domain: string): boolean => !!domain.match(/[a-z0-9.]+/i);

/**
 * Return a hexadecimal-encoded sha256 hash of an input string
 */
export const hashHex = (string: string): string => createHash('sha256').update(string).digest('hex');
