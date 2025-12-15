import { type FastifyPluginAsync } from 'fastify';
import { Readable, Transform, pipeline } from 'stream';
import { promisify } from 'util';
import { userService } from '../users/service';
import type { MultipartFile } from '@fastify/multipart';
import { s3Service } from '../../services/s3';
import { randomUUID } from 'crypto';

const asyncPipeline = promisify(pipeline);

const streamRoute: FastifyPluginAsync = async (fastify) => {
    // Server-Sent Events for real-time user updates
    fastify.get('/users', async (request, reply) => {
        reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
        });

        const sendEvent = (data: Record<string, any>) => {
            reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        // Send initial data
        sendEvent({ type: 'init', users: userService.findAll() });

        // Send updates every 5 seconds
        const interval = setInterval(() => {
        sendEvent({
            type: 'update',
            timestamp: new Date().toISOString(),
            userCount: userService.count(),
        });
        }, 5000);

        // Cleanup on connection close
        request.raw.on('close', () => {
            clearInterval(interval);
        });
    });

    // File upload with streaming
    fastify.post('/upload-file', async (request, reply) => {
        const data: MultipartFile | undefined = await request.file();

        if (!data) {
            return reply.badRequest('No file uploaded');
        }

        const chunks: Buffer[] = [];

        try {
            await asyncPipeline(
                data.file,
                new Transform({
                transform(chunk: Buffer, encoding, callback) {
                    chunks.push(chunk);
                    callback(null, chunk);
                },
                })
            );

            const buffer = Buffer.concat(chunks);

            return {
                filename: data.filename,
                mimetype: data.mimetype,
                size: buffer.length,
                encoding: data.encoding,
            };
        } catch (err) {
            request.log.error(err);
            return reply.internalServerError('Upload failed');
        }
    });

    // Stream large dataset
    fastify.get('/data', async (request, reply) => {
        reply.type('application/json');

        const readable = new Readable({
            read() {},
        });

        let count = 0;
        const maxItems = 1000;

        readable.push('[');

        const interval = setInterval(() => {
        if (count >= maxItems) {
            readable.push(']');
            readable.push(null);
            clearInterval(interval);
            return;
        }

        const item = JSON.stringify({
            id: count,
            data: `Item ${count}`,
            timestamp: Date.now(),
        });

        readable.push(count === 0 ? item : `,${item}`);
            count++;
        }, 10);

        return reply.send(readable);
    });

    // Update the upload endpoint
    fastify.post('/upload', async (request, reply) => {
        const data: MultipartFile | undefined = await request.file();
    
        if (!data) {
            return reply.badRequest('No file uploaded');
        }
    
        try {
        // Generate unique key
        const key = `uploads/${randomUUID()}-${data.filename}`;
        
        // Upload stream directly to S3
        const url = await s3Service.uploadStream(
            data.file,
            key,
            data.mimetype
        );
    
        return {
            filename: data.filename,
            mimetype: data.mimetype,
            key,
            url,
        };
        } catch (err) {
            request.log.error(err);
            return reply.internalServerError('Upload failed');
        }
    });
    
    // Get signed URL for private file
    fastify.get<{ Params: { key: string } }>('/file/:key', async (request, reply) => {
        try {
            const url = await s3Service.getSignedUrl(request.params.key, 3600);
            return { url };
        } catch (err) {
            request.log.error(err);
            return reply.notFound('File not found');
        }
    });
    
    // Delete file
    fastify.delete<{ Params: { key: string } }>('/file/:key', async (request, reply) => {
        try {
            await s3Service.deleteFile(request.params.key);
            return reply.code(204).send();
        } catch (err) {
            request.log.error(err);
            return reply.internalServerError('Delete failed');
        }
    });
};

export default streamRoute;