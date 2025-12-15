import { type FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import sensible from '@fastify/sensible';

const sensiblePlugin: FastifyPluginAsync = async (fastify) => {
    await fastify.register(sensible);
};

export default fp(sensiblePlugin);