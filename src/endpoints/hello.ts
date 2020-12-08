/**
 * 'Hello World' Endpoint
 */
import { Request, Response } from 'express';
import { EndpointController, Endpoint, GET } from '../controllers';

/**
 * Hello World endpoint controller
 */
@Endpoint('/hello')
export default class HelloController extends EndpointController {
  @GET('/')
  hello = (_req: Request, response: Response): void => {
    response.send('Hello world');
  };

  @GET('/:name')
  helloName = (request: Request, response: Response): void => {
    const { name } = request.params;

    // Invalid (400) responses
    if (
      // No name provided (Express shouldn't ever let this happen)
      !name ||
      // Invalid characters in name
      // @TODO improve this naive regex. ([Names are hard](https://www.kalzumeus.com/2010/06/17/falsehoods-programmers-believe-about-names/).)
      !name.match(/^[a-z ,.'-]+$/i)
    ) {
      response.status(400);
      response.send(`Invalid name`);
      return;
    }

    response.send(`Nice to meet you, ${name}`);
  };
}
