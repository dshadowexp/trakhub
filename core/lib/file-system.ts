import { createReadStream, createWriteStream, existsSync, statSync } from "fs";
import { unlink, rmdir, readdir } from "fs/promises";
import { Readable, Writable } from "stream";
import { pipeline } from "stream/promises";
import { dirname, join, relative } from "path";
import { IGNORE } from "./constants";

export class TrakFileSystem {
    static exists(path: string) {
        return existsSync(path);
    }

    static stats(path: string) {
        return statSync(path)
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
        const stack: string[] = [ directory ];

        while (stack.length > 0) {
            const currentDirectory = stack.pop()!;

            for (const dirEntry of (await readdir(currentDirectory, { withFileTypes: true })).filter((element) => !IGNORE.includes(element.name))) {
                if (dirEntry.isFile()) {
                    const { name, parentPath } = dirEntry;
                    files.push(relative(directory, join(parentPath, name)));
                } else if (dirEntry.isDirectory()) {
                    stack.push(dirEntry.name)
                }
            }
        }

        return files;
    }
}