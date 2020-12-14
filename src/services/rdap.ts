/**
 * Service to get RDAP information for a domain
 */
import { IncomingMessage } from 'http';
import https from 'https';

import { Service, Task, TaskResult, TaskResultData, TaskResultStatus, TaskService } from '../taskServices';
import Debug from '../debug';

const debug = Debug.extend('service:rdap');

const PROVIDER = process.env.PROVIDER_RDAP || 'rdap.net';
const PROVIDER_ROUTE_IP = process.env.PROVIDER_RDAP_ROUTE_IP || 'https://www.rdap.net/ip/';
const PROVIDER_ROUTE_DOMAIN = process.env.PROVIDER_RDAP_ROUTE_DOMAIN || 'https://www.rdap.net/domain/';

/**
 * Type for response handler methods
 */
type Handler = (res: IncomingMessage) => Promise<Object | Error>;

@Service({
  description: 'Lookup RDAP information for a domain or IP address',
  name: 'rdap',
  requiredData: {
    oneOf: [
      {
        ip: 'string',
        domain: 'string'
      }
    ]
  },
  returnType: typeof Boolean
})
export default class RDAPService extends TaskService {
  readonly #supportedHttpStatusCodes: number[];

  constructor() {
    super();

    // HTTP response status codes this implements handlers for
    // To handle more responses, add a new handler method with
    // pattern `#handleNNN` and type Handler
    // @TODO move this to a decorator; known at compile time
    this.#supportedHttpStatusCodes = Object.getOwnPropertyNames(this)
      .filter(prop => /^handle[0-9]{3}$/.test(prop))
      .map(prop => Number(prop.slice(-3)));
  }

  protected processTask = (task: Task): Promise<TaskResult> => {
    const { id, requestId, data } = task;
    const { ip, domain } = data;

    // Issue requests for both valid ip & domain separately
    const requests = [];
    if (ip) {
      requests.push(this.#start('ip', ip));
    }
    if (domain) {
      requests.push(this.#start('domain', domain));
    }

    // Wait for all request promises to finish
    return Promise.allSettled(requests)
      .then(allSettled => {
        debug(`${allSettled.length} request${allSettled.length > 1 ? 's' : ''} complete`);
        const resultData: TaskResultData = {};

        allSettled.forEach(settled => {
          // Should always be true but Typescript needs to this to know we can access settled.value
          if (settled.status !== 'fulfilled') {
            resultData.issues = resultData.issues || [];
            // @TODO This will do for now, we could logic which request this was.
            resultData.issues.push(`A request errored. This may be an issue with this server. Please report this.`);
          } else {
            const { value } = settled;
            const { address, result } = value;

            if (result instanceof Error) {
              resultData.issues = resultData.issues || [];
              resultData.issues.push(`${address}: ${result.message}`);
            } else {
              resultData.data = resultData.data || {};
              resultData.data[address] = result;
            }
          }
        });

        const issuesExist = resultData.issues?.length;
        const dataExists = resultData.data && Object.keys(resultData.data).length;
        let status: TaskResultStatus;
        if (issuesExist && dataExists) {
          status = 'partial-fail';
        } else if (issuesExist) {
          status = 'fail';
        } else {
          status = 'done';
        }

        return {
          id,
          requestId,
          resultData,
          status
        };
      })
      .catch(e => {
        return {
          id,
          requestId,
          resultData: { issues: [e.message] },
          status: 'fail'
        };
      });
  };

  handle200: Handler = res => {
    debug(`handle200()`);
    const { headers } = res;
    const contentType = headers['content-type'];

    if (!contentType || !/^application\/rdap\+json$/.test(contentType)) {
      const message = `Response from upstream provider has unexpected content-type${
        ' ' + contentType
      }. (Expected 'application/rdap+json'.`;

      const errorPromise = this.#errorPromise(message);

      res.resume(); // consume response data to free up memory

      debug(`handle200() returning errorPromise due to content-type ${contentType}`);
      return errorPromise;
    }

    return new Promise(resolve => {
      let raw = '';
      res.on('data', chunk => (raw += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          debug(`handle200() promise resolving with parsed data`);
          resolve(parsed);
        } catch (error) {
          debug(`handle200() promise resolving with error`);
          resolve(new Error(`Error processing data from upstream provider: ${error.message}`));
        }
      });
    });
  };

  handle302: Handler = res => {
    // @TODO track redirects, end early with too many or circular
    debug(`handle302()`);
    const { location } = res.headers;

    if (!location) {
      return this.#errorPromise(`Upstream provider sent a 302 redirect without a valid location header.`);
    }

    res.resume(); // consume response data to free up memory

    debug(`following redirect to ${location}`);

    return this.#sendRequest(location);
  };

  handle404: Handler = res => {
    debug(`handle404()`);

    res.resume(); // consume response data to free up memory

    // @TODO instead of PROVIDER, infer from headers, to support multiple hops in case of redirection
    return this.#errorPromise(
      `Upstream provider ${PROVIDER} could not find an authoritative RDAP server for this address.`
    );
  };

  /**
   * Handle responses with unsupported HTTP response status codes
   */
  handleUnsupported: Handler = res => {
    debug(`handleUnsupported()`);
    const { statusCode } = res;

    res.resume(); // consume response data to free up memory

    return this.#errorPromise(`Request to upstream provider returned unsupported status code ${statusCode}`);
  };

  #start = async (
    addressType: 'ip' | 'domain',
    address: string
  ): Promise<{ addressType: string; address: string; result: Object | Error }> => {
    const endpoint =
      addressType === 'ip' ? PROVIDER_ROUTE_IP : addressType === 'domain' ? PROVIDER_ROUTE_DOMAIN : false;

    if (!endpoint) {
      throw new Error(`RDAPService.#sendRequest sent invalid addressType '${addressType}'`);
    }
    const url = `${endpoint}${address}`;

    const result = await this.#sendRequest(url);

    return Promise.resolve({ addressType, address, result });
  };

  #sendRequest = (url: string): Promise<any> => {
    debug(`GET ${url}`);

    // @TODO PRIORITY! validate & sanitize url before sending

    return new Promise(resolve => {
      https.get(url, async (res: IncomingMessage) => {
        const { headers, statusCode } = res;

        // No need to sanitize as this is only for debugging
        const contentType = headers['content-type'];

        debug(`statusCode: ${statusCode}; contentType: ${contentType}`);

        if (!statusCode) {
          resolve(new Error(`Unable to process response from upstream provider ${PROVIDER}`));

          res.resume(); // consume response data to free up memory
          return;
        }

        res.setEncoding('utf8');

        let handler = this.#supportedHttpStatusCodes.includes(statusCode) ? `handle${statusCode}` : 'handleUnsupported';

        // @TODO fix: `this` call within callback below prevents handlers from being private, which they ideally should be
        resolve(await this[handler](res));
      });
    });
  };

  /**
   * Return a promise resolved to an Error with a given message
   */
  #errorPromise = (message: string): Promise<Error> => {
    return Promise.resolve(new Error(message));
  };

  // index type enables calling this[handler]
  [index: string]: any;
}
