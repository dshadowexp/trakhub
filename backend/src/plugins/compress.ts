import { type FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import compress from '@fastify/compress';

const compressPlugin: FastifyPluginAsync = async (fastify) => {
    await fastify.register(compress, {
        global: true,
        threshold: 1024,
        encodings: ['gzip', 'deflate'],
    });
};

export default fp(compressPlugin);