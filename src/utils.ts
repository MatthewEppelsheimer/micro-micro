import { createHash } from 'crypto';

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
