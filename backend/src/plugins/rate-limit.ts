import { type FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import { config } from '../config';

const rateLimitPlugin: FastifyPluginAsync = async (fastify) => {
    await fastify.register(rateLimit, {
        max: config.rateLimit.max,
        timeWindow: config.rateLimit.timeWindow,
        cache: 10000,
        allowList: ['127.0.0.1'],
        redis: config.redis.url,
    });
};

export default fp(rateLimitPlugin);