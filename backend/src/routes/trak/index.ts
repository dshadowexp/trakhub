import { type FastifyPluginAsync } from 'fastify';
import { exec } from 'child_process';
import { promisify } from 'util';
import { pipeline } from 'stream';
import { promisify as pipelinePromise } from 'util';

const execAsync = promisify(exec);
const asyncPipeline = pipelinePromise(pipeline);

const trakRoute: FastifyPluginAsync = async (fastify) => {
    // Git info/refs endpoint
    fastify.get('/:namespace/:repo/info/refs', async (request, reply) => {
        const { namespace, repo } = request.params as { namespace: string; repo: string };
        const service = request.query as { service?: string };

        request.log.info({ namespace, repo, service: service.service }, 'Git info/refs request');

        if (!service.service || !['git-upload-pack', 'git-receive-pack'].includes(service.service)) {
            return reply.code(400).send({ error: 'Invalid service' });
        }

        // Example: Point to your git repositories directory
        const repoPath = `/path/to/repos/${namespace}/${repo}`;

        try {
            // const { stdout } = await execAsync(
            //     `git ${service.service.replace('git-', '')} --stateless-rpc --advertise-refs "${repoPath}"`
            // );

            reply.header('Content-Type', `application/x-${service.service}-advertisement`);
            reply.header('Cache-Control', 'no-cache');
            
            // Git protocol requires this specific format
            const packetLine = `# service=${service.service}\n`;
            const length = (packetLine.length + 4).toString(16).padStart(4, '0');
            
            return reply.send(`${length}${packetLine}0000{stdout}`);
        } catch (err) {
            request.log.error(err);
            return reply.code(404).send({ error: 'Repository not found' });
        }
    });

    // Git upload-pack endpoint (for clone/fetch)
    fastify.post('/:namespace/:repo/git-upload-pack', async (request, reply) => {
        const { namespace, repo } = request.params as { namespace: string; repo: string };
        const repoPath = `/path/to/repos/${namespace}/${repo}`;

        reply.header('Content-Type', 'application/x-git-upload-pack-result');
        reply.header('Cache-Control', 'no-cache');

        // Stream the git command
        const { spawn } = require('child_process');
        const gitProcess = spawn('git', ['upload-pack', '--stateless-rpc', repoPath]);

        request.raw.pipe(gitProcess.stdin);
        gitProcess.stdout.pipe(reply.raw);

        gitProcess.on('error', (err: Error) => {
        request.log.error(err);
        reply.code(500);
        });
    });

    // Git receive-pack endpoint (for push)
    fastify.post('/:namespace/:repo/git-receive-pack', async (request, reply) => {
        const { namespace, repo } = request.params as { namespace: string; repo: string };
        const repoPath = `/path/to/repos/${namespace}/${repo}`;

        reply.header('Content-Type', 'application/x-git-receive-pack-result');
        reply.header('Cache-Control', 'no-cache');

        const { spawn } = require('child_process');
        const gitProcess = spawn('git', ['receive-pack', '--stateless-rpc', repoPath]);

        request.raw.pipe(gitProcess.stdin);
        gitProcess.stdout.pipe(reply.raw);

        gitProcess.on('error', (err: Error) => {
            request.log.error(err);
            reply.code(500);
        });
    });
};

export default trakRoute;