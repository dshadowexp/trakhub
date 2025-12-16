import { chmodSync, createReadStream, createWriteStream, Dirent, existsSync, statSync } from "fs";
import { UnixFileModeEnum } from "../types";
import { Readable, Writable } from "stream";
import { pipeline } from "stream/promises";
import { unlink } from "fs/promises";
import { dirname, join, resolve } from "path";
import { readdir } from "fs/promises";
import { rmdir } from "fs/promises";

export const IGNORE: string[] = ['..', '.', '.trak', 'node_modules', 'bun.lock', 'README.md', '.gitignore', 'package.json', 'tsconfig.json', 'trak.sh', 'src', 'main.ts', 'bun.lockb', '.DS_Store', 'fakeconfig.txt', '.trakconfig', 'package-lock.json'];
const ignoreSet = new Set(IGNORE);

export class Workspace {
    constructor(private _dirname: string) {}

    resolve(path: string) {
        return join(this._dirname, path);
    }

    /**
     * 
     * @param path 
     * @returns 
     */
    exists(path: string) {
        return existsSync(this.resolve(path));
    }

    /**
     * 
     * @param path 
     * @returns 
     */
    stats(path: string) {
        return statSync(this.resolve(path));
    }

    /**
     * 
     */
    setMode(path: string, mode: string) {
        const modeConvert = parseInt(mode) & 0o777;
        chmodSync(path, modeConvert);
    }

    /**
     * 
     * @param stats 
     * @returns 
     */
    mode(path: string) {
        const stats = this.stats(path);
        return stats.isSymbolicLink() ? UnixFileModeEnum.SYMBOLIC_LINK : (stats.mode & 0o111) !== 0 ? UnixFileModeEnum.EXECUTABLE_FILE : UnixFileModeEnum.REGULAR_FILE;
    }

    /**
     * 
     * @param path 
     * @returns 
     */
    isDirectory(path: string) {
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
    isFile(path: string) {
        return this.stats(path).isFile();
    }

    /**
     * 
     * @param path 
     * @returns 
     */
    async readFile(path: string) {
        const chunks: Buffer[] = [];
        const collectStream = new Writable({
            write(chunk, encoding, callback) {
                chunks.push(chunk);
                callback();
            }
        });

        await pipeline(createReadStream(this.resolve(path)), collectStream);
        return Buffer.concat(chunks);
    }

    /**
     * 
     * @param path 
     * @param data 
     */
    async writeFile(path: string, data: string | Buffer) {
        await pipeline(Readable.from(data), createWriteStream(this.resolve(path)));
    }

    /**
     * 
     * @param path 
     * @param endDir 
     */
    async removeFile(path: string, endDir?: string) {
        path = this.resolve(path);
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
    async listFiles(directory: string) {
        const files: string[] = [];
        const stack: string[][] = [ [directory, ''] ];

        while (stack.length > 0) {
            const [currentDirectory, parent] = stack.pop()!;

            for (const dirEntry of (await this.readDirectory(currentDirectory, true) as Dirent[])) {
                const fullPath = join(parent, dirEntry.name);

                if (dirEntry.isFile()) {
                    files.push(fullPath);
                } else if (dirEntry.isDirectory()) {
                    stack.push([dirEntry.name, fullPath])
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
    async readDirectory(path: string, withFileTypes: boolean = false ) {
        if (withFileTypes)
            return (await readdir(path, { withFileTypes: true })).filter((element) => !ignoreSet.has(element.name));
        else
            return (await readdir(path)).filter((element) => !ignoreSet.has(element));
    }

    makePathsAbsolute(paths: string[]): Set<string> {
        // Make paths absolute
        const absolutePaths = new Set<string>();

        for (const path of paths) {
            // Resolve path argument
            const absolutePath = resolve(path);
            if (absolutePath.startsWith(this._dirname)) {
                absolutePaths.add(absolutePath);
            } else {
                throw new Error(`Cannot remove paths outside of worktree: ${ path }`);
            }
        }
    
        return absolutePaths;
    }
}