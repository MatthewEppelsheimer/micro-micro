/**
 * Check whether a string is a valid IPv4 address
 */
export const isIPValid = (ip: string): boolean => !!ip.match(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/);
