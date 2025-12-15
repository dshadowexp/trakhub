import Fastify, { type FastifyInstance } from 'fastify';
import { config } from './config';

// Plugins
import sensiblePlugin from './plugins/sensible';
import helmetPlugin from './plugins/helmet';
import corsPlugin from './plugins/cors';
import rateLimitPlugin from './plugins/rate-limit';
import compressPlugin from './plugins/compress';

// Routes
import healthRoute from './routes/health';
import usersRoute from './routes/users';
import trakRoute from './routes/trak';

export async function buildApp() {
    const app = Fastify({
        logger: {
            level: config.server.logLevel,
            serializers: {
                req(req) {
                    return {
                        method: req.method,
                        url: req.url,
                        hostname: req.hostname,
                        remoteAddress: req.ip,
                    };
                },
            },
        },
        trustProxy: true,
        requestIdHeader: 'x-request-id',
        requestIdLogLabel: 'reqId',
        disableRequestLogging: false,
        bodyLimit: config.bodyLimit,
        ajv: {
            customOptions: {
                removeAdditional: 'all',
                coerceTypes: true,
                useDefaults: true,
            },
        },
    });

    // Register plugins
    await app.register(sensiblePlugin);
    await app.register(helmetPlugin);
    await app.register(corsPlugin);
    await app.register(rateLimitPlugin);
    await app.register(compressPlugin);
    await app.register(require('@fastify/multipart'));

    // Register routes
    await app.register(healthRoute, { prefix: '/health' });
    await app.register(usersRoute, { prefix: '/api/users' });
    await app.register(trakRoute, { prefix: '' });

    // Error handler
    app.setErrorHandler((error: any, request, reply) => {
        request.log.error(error);

        if (error.validation) {
            return reply.code(400).send({
                error: 'Validation Error',
                details: error.validation,
            });
        }

        const statusCode = error.statusCode || 500;
        reply.code(statusCode).send({
            error: error.message || 'Internal Server Error',
            statusCode,
        });
    });

    // Not found handler
    app.setNotFoundHandler((request, reply) => {
        reply.code(404).send({
            error: 'Not Found',
            message: `Route ${request.method}:${request.url} not found`,
        });
    });

    return app;
}