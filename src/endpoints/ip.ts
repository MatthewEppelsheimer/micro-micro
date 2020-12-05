/**
 * IP Address Services endpoint
 */
import { Request, Response } from 'express';
import { Controller, Endpoint, GET } from '../controllers';
import { AvailableServices, DefaultServices, validateIP } from '../services/';

/**
 * Hello World endpoint controller
 */
@Endpoint('/ip')
export default class IPServicesController implements Controller {
  /**
   * Respond with available services
   */
  @GET('/')
  help = (_req: Request, response: Response): void => {
    response.send('NOT YET IMPLEMENTED');
  };

  @GET('/:ip')
  doTasks = (request: Request, response: Response): void => {
    const { ip } = request.params;
    const { services } = request.body;

    /**
     * @WIPPOINT
     *
     *  @TODO…
     *    - if no services requested, use default services
     *    - if services requested, validate they all are available
     *    - identify point to fork into separate private methods:
     *        - one to wait for tasks to complete before responding (spec)
     *        - [DEFER!] one to send 'got it' with a 'poll here' URL
     *    - break up tasks
     *    - send tasks to work queue
     *    - subscribe to Redis updates & respond, packaging response when done
     *    - try/catch with 500 response
     */

    // Invalid (400) responses
    if (
      // No ip provided (Express shouldn't ever let this happen)
      !ip ||
      // Invalid IP address
      !validateIP(ip)
    ) {
      response.status(400);
      response.send(`Invalid IP address`);
      return;
    }

    response.send(`NOT YET IMPLEMENTED`);
  };
}
