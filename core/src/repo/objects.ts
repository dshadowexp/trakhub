import { dirname, join } from 'path';
import { createHash } from 'crypto';
import { createReadStream, createWriteStream } from "fs";
import { mkdir } from 'fs/promises';
import { Readable, Writable } from "stream";
import { pipeline } from "stream/promises";
import { createDeflate, createInflate } from "zlib";
import { getTimezone } from '../util';
import { FileSystem } from '../lib/standard';
import { TrakAuthor } from './author';
import { NULL_BYTE, type TrakTreeEntry } from '../types';

export enum TObjectType {
    COMMIT = "commit",
    TREE = "tree",
    BLOB = "blob",
}

export class TObjects {
    constructor(private _objectsFolderPath: string) {}

    async writeObject(object: TObject, write?: boolean) {
        // Compute object hash
        const objectHash = object.hash();

        if (write) {
            // Create the directory structure (e.g., .git/objects/ab/cdefgh...)
            const objectFilePath = join(this._objectsFolderPath, objectHash.substring(0, 2), objectHash.substring(2));

            // Ensure directory exists
            if (!FileSystem.exists(dirname(objectFilePath))) {
                await mkdir(dirname(objectFilePath), { recursive: true });
            }

            const result = Buffer.concat([Buffer.from(`${ object.type } ${ object.content.byteLength }${ NULL_BYTE }`), object.content]);
        
            await pipeline(
                Readable.from(result), 
                createDeflate(), 
                createWriteStream(objectFilePath)
            );
        }

        return objectHash;
    }

    async readRaw(hash: string) {
        const [objectType, size, content] = await this._readObjectHeader(hash);
        return {
            type: objectType,
            size,
            data: content
        };
    }

    async readTreeObject(hash: string): Promise<TTree> {
        const treeObject = await this.readObject(hash);
        if (treeObject.type !== TObjectType.TREE)
            throw new Error(`Object ${hash} is not a tree object`);

        return treeObject as TTree;
    }

    async readCommitObject(hash: string): Promise<TCommit> {
        const treeObject = await this.readObject(hash);
        if (treeObject.type !== TObjectType.COMMIT)
            throw new Error(`Object ${hash} is not a commit object`);

        return treeObject as TCommit;
    }

    async readObject(hash: string): Promise<TBlob | TTree | TCommit> {
        const [objectType, _, content] = await this._readObjectHeader(hash);

        const baseObject = new TObject(objectType as TObjectType, content);
        switch(objectType as TObjectType) {
            case TObjectType.BLOB:
                return TBlob.deserialize(baseObject.content);
            case TObjectType.TREE:
                return TTree.deserialize(baseObject.content);
            case TObjectType.COMMIT:
                return TCommit.deserialize(baseObject.content);
            default:
                throw new Error(`Unknown type ${ objectType } for object ${ hash }`);
        }
    } 

    private async _readObjectHeader(hash: string): Promise<[string, number, Buffer]> {
        const path = join(this._objectsFolderPath, hash.substring(0, 2), hash.substring(2));

        if (!path || !FileSystem.exists(path))
            throw new Error(`Object ${hash} not found`);

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
            throw new Error(`Size mismatch: expected ${size}, got ${content.byteLength}\n`);
        }

        return [objectType, size, content];
    }
}

export class TObject {
    protected _type: string;
    protected _content: Buffer;

    constructor(objType: TObjectType, data: Buffer = Buffer.from('')) {
        this._type = objType;
        this._content = data;
        this._content = this.serialize();
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
        return this._content;
    };
}

export class TBlob extends TObject {
    constructor(data: Buffer) {
        super(TObjectType.BLOB, data);
    }

    static deserialize(content: Buffer): TBlob {
        return new TBlob(content);
    }
}

export class TTree extends TObject {
    constructor(private _entries: TrakTreeEntry[] = []) {
        super(TObjectType.TREE);
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

    static deserialize(content: Buffer): TTree {
        // Initialize tree
        const tree = new TTree();
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

export class TCommit extends TObject {
    constructor(
        private _treeHash: string, 
        private _parentHashes: string[], 
        private _author: TrakAuthor, 
        private _committer: TrakAuthor,
        private _message: string,
    ) {
        super(TObjectType.COMMIT);
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

    static deserialize(content: Buffer): TCommit {
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
        return new TCommit(treeHash!, parentHashes, author!, committer!, message);
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