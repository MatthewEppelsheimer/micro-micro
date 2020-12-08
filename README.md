# Micro-Micro: A composable micro-service API implementation framework (in its infancy)

Micro-Micro: So named because it is a REST microservice API that is itself composed of lightweight, tightly encapsulated, easily configurable, swappable microservice components for ease of use rapidly building out new functionality.

It's services all the way down. And they're all _micro-_.

**NOTE: THIS IS AN AKWARD EARLY WORK IN PROGRESS!. Pre-1.0!**

* TypeScript
* Node.js
* Redis

## Mmmmmkay but what does it do?

This initial incarnation is a REST microservice for IP address information lookup — _but mostly just because that's a great use case for dogfooding this architecture_.

Adding new features, new aspects of information to lookup for an IP or domain address, like GeoIP, RDAP, ping, etc.. is simple! Just add a single class with the `@Service` decorator, import it into an index file, re-deploy, and boom! Your existing endpoints will automatically support the new service, include its documentation in interactive request/response dialogs, and satisfy user requests for it.

## Mmmmkay but what is the vision?

This currently includes a couple of 'hello world' route controllers and specialized services for background-task processing.

But! The core of Micro-Micro is its architecture, which has two primary goals:

1. Performance — every kind of parallelization available is built in
2. Make microservices faster to build and extend. Microservices for everyone!

The primary pattern is a few decorators enable quick addition of new endpoints and new capabilities for existing endpoints. They are incredibly easy to use, _and_ incredibly powerful. 

As this matures with ongoing development and use, I'll be gradually re-organizing code to abstract the highest-value, reusable pieces into a microservice composition framework. The IP lookup aspects will serve as a reference implementation.

## Mmmkay how about some lists of features and things?

Sure thing!

**Features and things:**

- Performant concurrent Node.js clustering
- Job queue with parallel background task processing, scalable to any number of workers
- 100% well-typed TypeScript
- Thorough inline documentation that _loves_ you.
- Deploys to Heroku
- REST patterns
- Ease of debugging with `debug('micro-micro')` throughout

**Built with:**

- Express.js server
- BullMQ job queue backed by Redis
- `throng` for Node.js cluster abstraction
- Love

**Lots on the horizon, including:**

- OpenAPI spec
- Dockerization
- tests tests tests!
- webpack for CI pipeline optimization
- modules for composing dynamic request/response interactions, empowering clients to be as smart as they'd like to be

## Tooling

- ESLint
- Prettier
