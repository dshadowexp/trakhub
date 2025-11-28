import { createReadStream, createWriteStream, Dirent, existsSync, Stats, statSync } from "fs";
import { unlink, rmdir, readdir } from "fs/promises";
import { Readable, Writable } from "stream";
import { pipeline } from "stream/promises";
import { dirname, join } from "path";
import { spawn } from "child_process";
import { UnixFileModeEnum } from "../types";

export class Terminal {
    /**
     * 
     * @param content 
     */
    static print(content: string) {
        process.stdout.write(content);
    }

    /**
     * 
     * @param content 
     */
    static println(content: string) {
        this.print(`${ content }\n`);
    }

    /**
     * Returns a writable stream to a pager process (less).
     * If the pager process cannot be spawned, it returns process.stdout as a fallback.
     *
     * @returns {Writable} A writable stream to either the pager or stdout.
     */
    static getPager(): Writable {
        try {
            // Spawn `less` with options:
            // -R: allows for raw control characters (enables color)
            // -F: exits if the entire output fits on one screen
            // -X: disables sending termcap init/deinit strings
            const pager = spawn('less', ['-RFX'], {
                stdio: ['pipe', process.stdout, process.stderr]
            });

            // Get the pager's input stream
            const pagerStream = pager.stdin;

            // If the main process is killed, ensure the pager is also terminated.
            const cleanup = () => {
                if (!pager.killed) {
                    pager.kill();
                }
            };
            process.on('exit', cleanup);
            process.on('SIGINT', cleanup); // Handle Ctrl+C

            // When the pager stream closes (e.g., user quits with 'q'),
            // we can stop writing to it. This also helps prevent 'write after end' errors.
            pagerStream.on('close', () => {
                // The pager has closed, so we should clean up listeners to avoid leaks.
                process.removeListener('exit', cleanup);
                process.removeListener('SIGINT', cleanup);
            });
            
            // Handle errors, such as if the user quits the pager early, which can
            // cause a 'pipe closed' error on write. We can safely ignore it.
            pagerStream.on('error', (err: NodeJS.ErrnoException) => {
                if (err.code !== 'EPIPE') {
                    // For any error other than a closed pipe, re-throw it.
                    throw err;
                }
            });

            return pagerStream;

        } catch (e) {
            // If spawning `less` fails for any reason, fall back to stdout.
            return process.stdout;
        }
    }
}

export const IGNORE: string[] = ['..', '.', '.trak', 'node_modules', 'bun.lock', 'README.md', '.gitignore', 'package.json', 'tsconfig.json', 'trak.sh', 'src', 'main.ts', 'bun.lockb', '.DS_Store', 'testf'];
const ignoreSet = new Set(IGNORE);

export class FileSystem {
    /**
     * 
     * @param path 
     * @returns 
     */
    static exists(path: string) {
        return existsSync(path);
    }

    /**
     * 
     * @param path 
     * @returns 
     */
    static stats(path: string) {
        return statSync(path)
    }

    /**
     * 
     * @param stats 
     * @returns 
     */
    static mode(stats: Stats) {
        return stats.isSymbolicLink() ? UnixFileModeEnum.SYMBOLIC_LINK : (stats.mode & 0o111) !== 0 ? UnixFileModeEnum.EXECUTABLE_FILE : UnixFileModeEnum.REGULAR_FILE;
    }

    /**
     * 
     * @param path 
     * @returns 
     */
    static isDirectory(path: string) {
        try {
            const stats = this.stats(path);
            return stats.isDirectory();
        } catch (err: any) {
            if (err.code === 'ENOENT') {
                return false;
            }
            throw err;
        }
    }

    /**
     * 
     * @param path 
     * @returns 
     */
    static isFile(path: string) {
        return FileSystem.stats(path).isFile();
    }

    /**
     * 
     * @param path 
     * @returns 
     */
    static async readFile(path: string) {
        const chunks: Buffer[] = [];
        const collectStream = new Writable({
            write(chunk, encoding, callback) {
                chunks.push(chunk);
                callback();
            }
        });

        await pipeline(createReadStream(path), collectStream);
        return Buffer.concat(chunks);
    }

    /**
     * 
     * @param path 
     * @param data 
     */
    static async writeFile(path: string, data: string | Buffer) {
        await pipeline(Readable.from(data), createWriteStream(path));
    }

    /**
     * 
     * @param path 
     * @param endDir 
     */
    static async removeFile(path: string, endDir?: string) {
        await unlink(path);

        if (endDir) {
            // Remove empty parent directories
            let parentDir = dirname(path);
            while (parentDir !== endDir && parentDir !== dirname(parentDir)) {
                try {
                    const entries = await readdir(parentDir);

                    if (entries.length === 0) {
                        await rmdir(parentDir);
                        parentDir = dirname(parentDir);
                    } else {
                        break;
                    }
                } catch {
                    break;
                }
            }
        }
    }

    /**
     * 
     * @param directory 
     * @returns 
     */
    static async listFiles(directory: string) {
        const files: string[] = [];
        const stack: string[][] = [ [directory, ''] ];

        while (stack.length > 0) {
            const [currentDirectory, parent] = stack.pop()!;

            for (const dirEntry of (await FileSystem.readDirectory(currentDirectory, true) as Dirent[])) {
                const { name } = dirEntry;
                if (dirEntry.isFile()) {
                    files.push(join(parent, name));
                } else if (dirEntry.isDirectory()) {
                    stack.push([dirEntry.name, join(parent, name)])
                }
            }
        }

        return files;
    }

    /**
     * 
     * @param path 
     * @param withFileTypes 
     * @returns 
     */
    static async readDirectory(path: string, withFileTypes: boolean = false ) {
        if (withFileTypes)
            return (await readdir(path, { withFileTypes: true })).filter((element) => !ignoreSet.has(element.name));
        else
            return (await readdir(path)).filter((element) => !ignoreSet.has(element));
    }
}