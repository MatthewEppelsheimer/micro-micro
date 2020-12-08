import { parse } from 'url';

// @TODO rename this file to designate it is queue connection-specific
// @TODO export an instantiated ioredis connection
//       for re-use in IPServicesController & RequestTaskBatchResolver
// BullMQ Queue Connection Info
const REDIS_URL = parse(process.env.REDIS_URL || 'http://127.0.0.1:6379');

const { port, hostname, auth } = REDIS_URL;

export const QUEUE = {
  CONFIG: {
    connection: {
      host: hostname || process.env.REDIS_HOST || 'localhost',
      port: Number(port) || Number(process.env.REDIS_PORT) || 6379,
      password: auth || process.env.REDIS_PASSWORD || 'pass',
      db: Number(process.env.REDIS_DB) || 0
    }
  },
  NAME: process.env.QUEUE_NAME || 'microservice-ipinfo-tasks'
};
