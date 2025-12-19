import { chmodSync, createReadStream, createWriteStream, existsSync, Stats, statSync } from "fs";
import { UnixFileModeEnum } from "../types";
import { Readable, Writable } from "stream";
import { pipeline } from "stream/promises";
import { unlink } from "fs/promises";
import { dirname, join, relative } from "path";
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
        return existsSync(path);
    }

    /**
     * 
     * @param path 
     * @returns 
     */
    stats(path: string) {
        try {
            return statSync(path);
        } catch (err: any) {
            console.log(err); 
            // if (err.code === 'ENOENT') {
            //     return null;
            // }
            throw err;
        }
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
        const stats = this.stats(path);
        return stats.isDirectory();
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
    async listFiles(directory: string | undefined): Promise<[string, Stats][]> {
        const files: [string, Stats][] = [];
        const stack: Array<[string, string]> = [[join(this._dirname, directory || ""), ""]];
      
        while (stack.length > 0) {
            const [currentPath, parent] = stack.pop()!;
            const stats = this.stats(currentPath);
        
            if (stats.isDirectory()) {
                const entries = await readdir(currentPath);
            
                for (const name of entries) {
                    if (ignoreSet.has(name)) continue;
            
                    const fullPath = join(currentPath, name);
                    const relPath = parent ? join(parent, name) : name;
            
                    stack.push([fullPath, relPath]);
                }
            } else if (stats.isFile()) {
                files.push([relative(this._dirname, currentPath), stats]);
            } else {
                throw new Error(
                    `pathspec '${currentPath}' did not match any files`
                );
            }
        }
      
        return files;
    }
}