import { buildApp } from './app';
import { config } from './config';

async function start() {
    const app = await buildApp();

    // Graceful shutdown
    const closeGracefully = async (signal: string) => {
        app.log.info(`Received ${signal}, closing server gracefully`);
        await app.close();
        process.exit(0);
    };

    process.on('SIGINT', () => closeGracefully('SIGINT'));
    process.on('SIGTERM', () => closeGracefully('SIGTERM'));

    try {
        await app.listen({
        port: config.server.port,
        host: config.server.host,
        });
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
}

start();