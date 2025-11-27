import Fastify, { type FastifyInstance } from "fastify";

export function buildApp() {
  const app: FastifyInstance = Fastify({})

//   // Register plugins
//   app.register(corsPlugin);
//   app.register(dbPlugin);

//   // Register routes
//   app.register(healthRoutes, { prefix: "/health" });
//   app.register(userRoutes, { prefix: "/users" });

  return app;
}