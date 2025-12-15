import { type FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import { config } from '../config';

const corsPlugin: FastifyPluginAsync = async (fastify) => {
    await fastify.register(cors, config.cors);
};

export default fp(corsPlugin);