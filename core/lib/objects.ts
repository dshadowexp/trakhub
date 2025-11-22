import { createWriteStream } from 'fs';
import { readFile, stat } from "fs/promises";
import { dirname, join, resolve } from 'path';
import { createSHA1hash, getByteSize } from './util';
import { createDeflate } from 'zlib';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { mkdir } from 'fs/promises';
import { readdir } from 'fs/promises';

export class Author {
    constructor(private name: string, private email: string, private time: Date) {}

    private formatTimestamp(date: Date): string {
        const seconds = Math.floor(date.getTime() / 1000);
        const offset = -date.getTimezoneOffset();
        const hours = Math.floor(Math.abs(offset) / 60);
        const minutes = Math.abs(offset) % 60;
        const sign = offset >= 0 ? '+' : '-';
        const timezone = `${sign}${String(hours).padStart(2, '0')}${String(minutes).padStart(2, '0')}`;
        
        return `${seconds} ${timezone}`;
    }

    toString(): string {
        const timestamp = this.formatTimestamp(this.time);
        return `${ this.name } <${ this.email }> ${ timestamp }`;
    }
}

export class WorkSpace {
    IGNORE: string[] = ['..', '.', '.trak', 'node_modules', 'bun.lock', 'README.md', '.gitignore', 'package.json', 'tsconfig.json', 'trak.sh', 'lib', 'main.ts']


    constructor(private _pathName: string) {}

    async *listFiles(dirPath: string = this._pathName): AsyncGenerator<string> {
        try {
            const entries = (await readdir(dirPath)).filter((element) => !this.IGNORE.includes(element));
            for (const dirent of entries) {
                const fullPath = join(dirPath, dirent);
                const stats = await stat(fullPath);

                if (stats.isDirectory()) {
                    yield* this.listFiles(fullPath);
                } else {
                    yield fullPath;
                }
            }
        } catch (error) {
            throw error;
        }
    }

    async readFileData(filePath: string): Promise<Buffer> {
        return await readFile(filePath);
    }
}

abstract class TObject {
    protected _id: string | undefined;
    protected _type: string | undefined;

    get id(): string | undefined {
        return this._id;
    }

    set id(objectHash: string | undefined) {
        this._id = objectHash;
    }

    get type(): string | undefined {
        return this._type;
    }

    abstract toString(): string;
}

export class TBlob extends TObject {
    constructor(private _data: Buffer) {
        super();
        this._type = "blob";
    }

    toString() {
        return this._data.toString('ascii');
    }
}

export class TTree extends TObject {
    ENTRY_FORMAT = "Z*H40"
    MODE = "100644"

    constructor(private _entries: { name: string, oid: string }[]) {
        super();
        this._type = "tree";
    }

    toString(): string {
        return this._entries.sort((a, b) => a.name.localeCompare(b.name)).map((entry) => {
            return Buffer.concat([Buffer.from(`${this.MODE} ${entry.name}\0`, 'ascii'), Buffer.from(entry.oid, 'hex')])
        }).join("");
    }
}

export class TCommit extends TObject {
    constructor(private _tree: string, private _author: Author, private _message: string) {
        super();
        this._type = "commit";
    }

    toString(): string {
        return [
            `tree ${this._tree}`,
            `author ${this._author.toString()}`,
            `committer ${this._author.toString()}`,
            "",
            this._message
        ].join("\n");
    }
}

export class TObjectsBase {
    private pathName: string;

    constructor(pathName: string) {
        this.pathName = pathName;
    }

    async store(object: TObject) {
        const objectString = object.toString();
        const content = `${object.type} ${getByteSize(objectString)}\0${objectString}`;
        object.id = createSHA1hash(content);
        await this.writeObject(object.id, content);
    }

    async writeObject(oid: string, content: string) {
        try {
            // Create the directory structure (e.g., .git/objects/ab/)
            const objectPath = join(this.pathName, oid.substring(0, 2), oid.substring(2));

            // Ensure directory exists
            await mkdir(dirname(objectPath), { recursive: true });
            
            // Pipeline streams
            await pipeline(Readable.from(content), createDeflate(), createWriteStream(objectPath));
        } catch (error) {
            throw new Error(`Error writing object ${oid}: ${error}\n`);
        }
    }
}