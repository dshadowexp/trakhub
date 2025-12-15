import { type FastifyPluginAsync } from 'fastify';

const healthRoute: FastifyPluginAsync = async (fastify) => {
    fastify.get(
        '/',
        {
        schema: {
            response: {
            200: {
                type: 'object',
                properties: {
                status: { type: 'string' },
                uptime: { type: 'number' },
                timestamp: { type: 'string' },
                },
            },
            },
        },
        },
        async () => {
            return {
                status: 'ok',
                uptime: process.uptime(),
                timestamp: new Date().toISOString(),
            };
        }
    );
};

export default healthRoute;