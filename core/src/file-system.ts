import { createReadStream, createWriteStream, Dirent, existsSync, Stats, statSync } from "fs";
import { unlink, rmdir, readdir } from "fs/promises";
import { Readable, Writable } from "stream";
import { pipeline } from "stream/promises";
import { dirname, join, relative } from "path";
import { UnixFileModeEnum } from "./types";

export const IGNORE: string[] = ['..', '.', '.trak', 'node_modules', 'bun.lock', 'README.md', '.gitignore', 'package.json', 'tsconfig.json', 'trak.sh', 'src', 'main.ts', 'bun.lockb'];
const ignoreSet = new Set(IGNORE);

export class TrakFileSystem {
    static exists(path: string) {
        return existsSync(path);
    }

    static stats(path: string) {
        return statSync(path)
    }

    static mode(stats: Stats) {
        return stats.isSymbolicLink() ? UnixFileModeEnum.SYMBOLIC_LINK : (stats.mode & 0o111) !== 0 ? UnixFileModeEnum.EXECUTABLE_FILE : UnixFileModeEnum.REGULAR_FILE;
    }

    static isDirectory(path: string) {
        return TrakFileSystem.stats(path).isDirectory();
    }

    static isFile(path: string) {
        return TrakFileSystem.stats(path).isFile();
    }

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

    static async writeFile(path: string, data: string | Buffer) {
        await pipeline(Readable.from(data), createWriteStream(path));
    }

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

    static async listFiles(directory: string) {
        const files: string[] = [];
        const stack: string[][] = [ [directory, ''] ];

        while (stack.length > 0) {
            const [currentDirectory, parent] = stack.pop()!;

            for (const dirEntry of (await TrakFileSystem.readDirectory(currentDirectory, true) as Dirent[])) {
                const { name } = dirEntry;
                if (dirEntry.isFile()) {
                    files.push(relative(directory, join(parent, name)));
                } else if (dirEntry.isDirectory()) {
                    stack.push([dirEntry.name, join(parent, name)])
                }
            }
        }

        return files;
    }

    static async readDirectory(path: string, withFileTypes: boolean = false ) {
        if (withFileTypes)
            return (await readdir(path, { withFileTypes: true })).filter((element) => !ignoreSet.has(element.name));
        else
            return (await readdir(path)).filter((element) => !ignoreSet.has(element));
    }
}