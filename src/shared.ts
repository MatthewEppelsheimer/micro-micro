import { parse } from 'url';

// BullMQ Queue Connection Info
const REDIS_URL = parse(process.env.REDIS_URL || 'http://127.0.0.1:6379');

const { port, hostname, auth } = REDIS_URL;

export const QUEUE = {
  CONFIG: {
    connection: {
      host: hostname || 'localhost',
      port: Number(port) || Number(process.env.REDIS_PORT) || 6379,
      password: auth || process.env.REDIS_PASSWORD || 'pass',
      db: Number(process.env.REDIS_DB) || 0
    }
  },
  NAME: process.env.QUEUE_NAME || 'microservice-ipinfo-tasks'
};
