import { createHash } from 'crypto';
import { TrakAuthor, TrakObjectTypeEnum, type TrakTreeEntry } from '../types';
import { createReadStream, createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { createDeflate, createInflate } from "zlib";
import { Readable, Writable } from "stream";
import { TrakRepository } from "../repository";
import { getTimezone } from '../util';
import { FileSystem } from '../standard-lib';

export class TrakObjectsBase {
    static async writeObject(object: TrakObject, repo?: TrakRepository | null) {
        // Compute object hash
        const objectHash = object.hash();

        if (repo) {
            // Create the directory structure (e.g., .git/objects/ab/)
            const objectFilePath = await TrakRepository.repoFile(repo, true, "objects",  objectHash.substring(0, 2), objectHash.substring(2));

            // Ensure directory exists
            if (objectFilePath && !FileSystem.exists(objectFilePath)) {
                const result = Buffer.concat([Buffer.from(`${object.type} ${object.content.byteLength}\0`), object.content]);
        
                await pipeline(
                    Readable.from(result), 
                    createDeflate(), 
                    createWriteStream(objectFilePath)
                );
            }
        }

        return objectHash;
    }

    static async readObject(repo: TrakRepository, hash: string): Promise<TrakBlob | TrakTree | TrakCommit | null> {
        const path = await TrakRepository.repoFile(repo, false, "objects", hash.substring(0, 2), hash.substring(2));

        if (!path || !FileSystem.exists(path))
            throw new Error(`Object ${hash} not found`);

        if (!FileSystem.isFile(path))
            return null;

        const chunks: Buffer[] = [];
        const collectStream = new Writable({
            write(chunk, encoding, callback) {
                chunks.push(chunk);
                callback();
            }
        });

        await pipeline(
            createReadStream(path),
            createInflate(),
            collectStream
        );

        // Gather decompressed byte
        const decompressed = Buffer.concat(chunks);

        // Find index of null byte
        const nullIdx = decompressed.indexOf(0);
        if (nullIdx === -1) {
            throw new Error('Invalid object format: no null byte found');
        }

        const header = decompressed.subarray(0, nullIdx);
        const content = decompressed.subarray(nullIdx + 1);

        const parts = header.toString().split(' ');
        if (parts.length !== 2) {
            throw new Error(`Invalid header format: "${header}"`);
        }

        const [objectType, sizeStr] = parts;
        const size = parseInt(sizeStr, 10);
        
        // Verify content size matches header
        if (content.byteLength !== size) {
            process.stdout.write(`Size mismatch: expected ${size}, got ${content.byteLength}\n`);
        }

        const baseObject = new TrakObject(objectType as TrakObjectTypeEnum, content);
        switch(objectType as TrakObjectTypeEnum) {
            case TrakObjectTypeEnum.BLOB:
                return TrakBlob.deserialize(baseObject.content);
            case TrakObjectTypeEnum.TREE:
                return TrakTree.deserialize(baseObject.content);
            case TrakObjectTypeEnum.COMMIT:
                return TrakCommit.deserialize(baseObject.content);
            default:
                throw new Error(`Unknown type ${ objectType } for object ${ hash }`);
        }
    }  
    
    static async exists(repo: TrakRepository, hash: string): Promise<boolean> {
        const path = await TrakRepository.repoFile(repo, false, "objects", hash.substring(0, 2), hash.substring(2));

        return path != undefined && FileSystem.exists(path);
    }
}

export class TrakObject {
    protected _type: string;
    protected _content: Buffer;

    constructor(objType: TrakObjectTypeEnum, data: Buffer = Buffer.from('')) {
        this._type = objType;
        this._content = data;
    }

    get type(): string | undefined {
        return this._type;
    }

    get content(): Buffer {
        return this._content;
    }

    hash(): string {
        const header = Buffer.from(`${this._type} ${this._content.byteLength}\0`);
        const hash = createHash('sha1');
        hash.update(Buffer.concat([header, this._content]));
        return hash.digest('hex');
    }

    serialize(): Buffer {
        throw new Error('rawise not implemented');
    };
}

export class TrakBlob extends TrakObject {
    constructor(data: Buffer) {
        super(TrakObjectTypeEnum.BLOB, data);
    }

    serialize(): Buffer {
        return this._content;
    }

    static deserialize(content: Buffer): TrakBlob {
        return new TrakBlob(content);
    }
}

export class TrakTree extends TrakObject {
    constructor(private _entries: TrakTreeEntry[] = []) {
        super(TrakObjectTypeEnum.TREE);
        this._content = this.serialize();
    }

    get entries(): TrakTreeEntry[] {
        return this._entries;
    }

    async addEntry(entry: TrakTreeEntry) {
        this._entries.push(entry);
        this._content = this.serialize();
    }

    serialize(): Buffer {
        return Buffer.concat(this._entries.sort((a, b) => a.name.localeCompare(b.name)).map((entry) => {
            return Buffer.concat([Buffer.from(`${ entry.mode } ${ entry.name }\0`), Buffer.from(entry.oid, 'hex')])
        }));
    }

    static deserialize(content: Buffer): TrakTree {
        // Initialize tree
        const tree = new TrakTree();
        let i = 0;

        while (i < content.length) {
            // Find index of null byte
            const nullIdx = content.indexOf(0, i);
            // Exit loop if null byte is absent from rest of content
            if (nullIdx === -1)
                break

            // Extract mode, name, and oid of current entry
            const [mode, name] = content.subarray(i, nullIdx).toString().split(" ");
            const oid = content.subarray(nullIdx + 1, nullIdx + 21).toString('hex');
            // Add entry to tree
            tree.addEntry({mode, name, oid});
            
            i = nullIdx + 21;
        }

        return tree;
    }
}

export class TrakCommit extends TrakObject {
    constructor(
        private _treeHash: string, 
        private _parentHashes: string[], 
        private _author: TrakAuthor, 
        private _committer: TrakAuthor,
        private _message: string,
    ) {
        super(TrakObjectTypeEnum.COMMIT);
        this._content = this.serialize();
    }

    get treeHash(): string {
        return this._treeHash;
    }

    get parentHashes(): string[] {
        return this._parentHashes;
    }

    get author(): TrakAuthor {
        return this._author;
    }

    get committer(): TrakAuthor {
        return this._committer;
    }

    get message(): string {
        return this._message;
    }

    serialize(): Buffer {
        const lines = [`tree ${this._treeHash}`];
        for (const parent of this._parentHashes) {
            lines.push(`parent ${ parent }`);
        }

        lines.push(`author ${ this._author.serialize() } ${ this._author.timestamp } ${ getTimezone(new Date(this._author.timestamp * 1000)) }`);
        lines.push(`committer ${ this._committer.serialize() } ${ this._author.timestamp } ${ getTimezone(new Date(this._author.timestamp * 1000)) }`);
        lines.push("");
        lines.push(this._message);

        // Convert to Buffer
        return Buffer.from(lines.join("\n"));
    }

    static deserialize(content: Buffer): TrakCommit {
        // Splits content by new line
        const lines = content.toString().split('\n');
        let treeHash = null, 
            parentHashes: string[] = [], 
            author: TrakAuthor | null = null, 
            committer: TrakAuthor | null = null, 
            timestamp: number | null = null,
            message_start = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (line.startsWith("tree")) {
                treeHash = line.substring(5);
            } else if (line.startsWith("parent ")) {
                parentHashes.push(line.substring(7));
            } else if (line.startsWith("author ")) {
                const parsed = this._unwrapAuthorLine(line.substring(7));
                author = parsed[0];
                timestamp = parsed[1];
            } else if (line.startsWith("committer ")) {
                committer = this._unwrapAuthorLine(line.substring(10))[0];
            } else if (line === "") {
                message_start = i + 1;
                break;
            }
        }

        const message = lines.splice(message_start).join('\n');
        return new TrakCommit(treeHash!, parentHashes, author!, committer!, message);
    }

    private static _unwrapAuthorLine(content: string): [TrakAuthor, number, string] {
        // Find last space (before timezone)
        const lastSpace = content.lastIndexOf(' ');
        const timezone = content.substring(lastSpace + 1);
        
        // Find second-to-last space (before timestamp)
        const secondLastSpace = content.lastIndexOf(' ', lastSpace - 1);
        const timestamp = parseInt(content.substring(secondLastSpace + 1, lastSpace), 10);
        
        // Everything before is the author
        const author = content.substring(0, secondLastSpace).split(' ');
        const name = author.slice(0, -1).join(' ');
        const email = author[author.length - 1].substring(1, author[author.length - 1].length - 1);

        return [new TrakAuthor(name, email), timestamp, timezone];
    }
}