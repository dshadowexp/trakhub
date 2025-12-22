import { chmodSync, createReadStream, createWriteStream, existsSync, Stats, statSync } from "fs";
import { DiffAction, UnixFileModeEnum } from "../types";
import { Readable, Writable } from "stream";
import { pipeline } from "stream/promises";
import { unlink } from "fs/promises";
import { dirname, join, relative } from "path";
import { readdir } from "fs/promises";
import { rmdir } from "fs/promises";
import type { Migration } from "../lib/migration";
import type { BaseEntry } from "./entries";

export const IGNORE: string[] = ['..', '.', '.trak', 'node_modules', 'bun.lock', 'README.md', '.gitignore', 'package.json', 'tsconfig.json', 'trak.sh', 'src', 'main.ts', 'bun.lockb', '.DS_Store', 'fakeconfig.txt', '.trakconfig', 'package-lock.json'];
const ignoreSet = new Set(IGNORE);

export class Workspace {
    constructor(private _dirname: string) {}

    resolve(path: string) {
        return join(this._dirname, path);
    }

    exists(path: string) {
        return existsSync(path);
    }

    stats(path: string) {
        console.log(path);
        try {
            return statSync(path);
        } catch (err: any) {
            if (err.code === 'ENOENT') {
                return null;
            }
            throw err;
        }
    }

    setMode(path: string, mode: string) {
        const modeConvert = parseInt(mode) & 0o777;
        chmodSync(path, modeConvert);
    }

    mode(path: string) {
        const stats = this.stats(path);
        if (!stats)
            return;
        return stats.isSymbolicLink() ? UnixFileModeEnum.SYMBOLIC_LINK : (stats.mode & 0o111) !== 0 ? UnixFileModeEnum.EXECUTABLE_FILE : UnixFileModeEnum.REGULAR_FILE;
    }

    isDirectory(path: string) {
        const stats = this.stats(path);
        if (!stats) 
            return;
        return stats.isDirectory();
    }

    isFile(path: string) {
        const stats = this.stats(path);
        if (!stats) 
            return;
        return stats.isFile();
    }

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

    async writeFile(path: string, data: string | Buffer) {
        await pipeline(Readable.from(data), createWriteStream(this.resolve(path)));
    }

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

    async listFiles(directory: string | undefined): Promise<[string, Stats][]> {
        const files: [string, Stats][] = [];
        const stack: Array<[string, string]> = [[join(this._dirname, directory || ""), ""]];
      
        while (stack.length > 0) {
            const [currentPath, parent] = stack.pop()!;
            const stats = this.stats(currentPath);
            if (!stats)
                continue;
        
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

    async applyMigration(migration: Migration) {
        await this._applyChangeList(migration, DiffAction.DELETE);
        // migration.rmdirs.sort.reverse_each { |dir| remove_directory(dir) }

        // migration.mkdirs.sort.reverse_each { |dir| remove_directory(dir) }
        await this._applyChangeList(migration, DiffAction.MODIFY);
        await this._applyChangeList(migration, DiffAction.ADD);
    }

    private async _applyChangeList(migration: Migration, action: DiffAction) {
        for (const [filePath, entry] of migration.changes.get(action)!) {
            const fullPath = join(this._dirname, filePath);
            await this.removeFile(fullPath, this._dirname);

            if (action === DiffAction.DELETE) continue;

            const data = await migration.blobData(entry!.hash);// TODO: check if need to continue if entry is null
            await this.writeFile(fullPath, data);
            //this.setMode(fullPath, entry!.mode);
        }
    }

    private _sortByDepth(actions: [string, (BaseEntry | undefined)][], descendingOrder: boolean = false) {
        return actions.sort((a, b) => {
            const depthA = (a[0].match(/\//g) || []).length;
            const depthB = (b[0].match(/\//g) || []).length;
    
            if (descendingOrder) {
                return depthA - depthB;
            } else {
                return depthB - depthA;
            }
        })
    }
}