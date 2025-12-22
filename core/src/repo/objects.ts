import { dirname, join, basename } from 'path';
import { createHash } from 'crypto';
import { createReadStream, createWriteStream, readdirSync } from "fs";
import { mkdir } from 'fs/promises';
import { Readable, Writable } from "stream";
import { pipeline } from "stream/promises";
import { createDeflate, createInflate } from "zlib";
import { getTimezone } from '../util';
import { FileSystem } from '../lib/standard';
import { TrakAuthor } from './author';
import { DiffAction, NULL_BYTE, UnixFileModeEnum } from '../types';
import { BaseEntry, IndexEntry, TreeEntry } from './entries';
import { TreeDiff } from '../lib/tree-diff';
import { PathFilter } from '../lib/path-filter';

export enum TObjectType {
    COMMIT = "commit",
    TREE = "tree",
    BLOB = "blob",
}

export class TObject {
    protected _type: string;
    protected _hash: string | null = null;
    
    constructor(objType: TObjectType, protected _content: any) { // TODO: investigate content if needed
        this._type = objType;
    }

    get type(): string {
        return this._type;
    }

    get hash(): string | null {
        return this._hash;
    }

    set hash(hash: string) {
        this._hash = hash;
    }

    serialize(): Buffer {
        throw new Error('Not Implemented'); 
    };
}

export class TBlob extends TObject {
    constructor(private _data: Buffer) {
        super(TObjectType.BLOB, _data);
    }

    get data() {
        return this._data;
    }

    serialize(): Buffer {
        return this._data;
    };

    static deserialize(data: Buffer): TBlob {
        return new TBlob(data);
    }
}

export class TTree extends TObject {
    constructor(private _entries: Map<string, TTree | TreeEntry> = new Map()) {
        super(TObjectType.TREE, _entries);
    }

    get mode(): string {
        return UnixFileModeEnum.DIR;
    }

    get entries(): Map<string, TTree | TreeEntry> {
        return this._entries;
    }

    addEntry(entry: TreeEntry, parents: string[]): void {
        if (parents.length === 0) {
            this._entries.set(entry.basename, entry);
            return;
        }
      
        const parent = parents[0];
        let tree = this._entries.get(basename(parent)) as TTree;
      
        if (!tree) {
            tree = new TTree();
            this._entries.set(basename(parent), tree);
        }
      
        tree.addEntry(entry, parents.slice(1));
    }

    serialize(): Buffer {
        return Buffer.concat(
            Array.from(this._entries.entries()).map(([name, entry]) => {
                return Buffer.concat([
                    Buffer.from(`${ entry.mode } ${ name }\0`), 
                    Buffer.from(entry.hash!, 'hex')
                ]);
            })
        );
    }

    *traverse(): Generator<TTree> {
        for (const entry of this._entries.values()) {
            if (entry instanceof TTree) {
                yield* entry.traverse();
            }
        }

        yield this;
    }

    static build(entries: Iterable<IndexEntry>) {
        const root = new TTree();
    
        for (const entry of entries) {
            const treeEntry = TreeEntry.fromIndex(entry);
            root.addEntry(treeEntry, entry.parentDirectories());
        }
    
        return root;
    }

    static deserialize(content: Buffer): TTree {
        // Initialize tree
        const entries: Map<string, TTree | TreeEntry> = new Map()
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

            entries.set(name, new TreeEntry(name, oid, mode));
            
            i = nullIdx + 21;
        }

        return new TTree(entries);
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
        super(TObjectType.COMMIT, "");
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

    get date(): number {
        return this._author.timestamp
    }
 
    get committer(): TrakAuthor {
        return this._committer;
    }

    get message(): string {
        return this._message;
    }

    get titleLine(): string {
        return this._message.split('\n')[0];
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

export class TObjects {
    private _objects: Map<string, TObject>;

    constructor(private _objectsFolderPath: string) {
        this._objects = new Map();
    }

    prefixMatch(name: string): string[] {
        try {
            const objectPath = this._objectPath(name);
            const dir = dirname(objectPath);
            const dirBase = basename(dir);
    
            const oids = readdirSync(dir).map((filename) => {
                return `${dirBase}${filename}`;
            });
    
            return oids.filter((oid) => oid.startsWith(name));
        } catch (err: any) {
            if (err.code === "ENOENT") {
                return [];
            }
            throw err;
        }
    }

    shortHash(sha: string) {
        return sha.slice(0, 7);
    }

    treeEntry(treeHash: string) {
        return new TreeEntry('', treeHash, UnixFileModeEnum.DIR);
    }

    async store(obj: TObject) {
        const content = this._serializeObject(obj);
        obj.hash = this.hashContent(content);
        await this.writeObject(obj.hash, content)
        return obj.hash;
    }

    async writeObject(hash: string, content: Buffer) {
        const objectFilePath = this._objectPath(hash);

        // Ensure directory exists
        if (!FileSystem.exists(dirname(objectFilePath))) {
            await mkdir(dirname(objectFilePath), { recursive: true });
        }

        await pipeline(
            Readable.from(content), 
            createDeflate(), 
            createWriteStream(objectFilePath)
        );
    }

    hashObject(obj: TObject) {
        return obj.hash ??= this.hashContent(this._serializeObject(obj));
    }

    hashContent(content: Buffer) {
        const hash = createHash('sha1');
        hash.update(content);
        return hash.digest('hex');
    }

    async loadRaw(hash: string) {
        const [objectType, size, content] = await this._readObjectHeader(hash);
        return {
            type: objectType,
            size,
            data: content
        };
    }

    async loadTree(hash: string): Promise<TTree> {
        const treeObject = await this.readObject(hash);
        if (treeObject.type !== TObjectType.TREE)
            throw new Error(`Object ${hash} is not a tree object`);

        return treeObject as TTree;
    }

    async loadTreeEntry(oid: string, pathname?: string): Promise<BaseEntry | null> {
        const commit = await this.loadCommit(oid);
        const root = new BaseEntry(commit.treeHash, UnixFileModeEnum.DIR)
    
        if (!pathname) return root;
    
        // for (const name of this._eachFilename(pathname)) {
        //     if (!entry) return null;
    
        //     const tree = await this.loadTree(entry.oid);
        //     entry = tree.entries.get(name) ?? null;
        // }
    
        // return entry;
        return null;
    }

    async loadCommit(hash: string): Promise<TCommit> {
        const treeObject = await this.readObject(hash);
        if (treeObject.type !== TObjectType.COMMIT)
            throw new Error(`Object ${hash} is not a commit object`);

        return treeObject as TCommit;
    }

    async loadBlob(hash: string): Promise<TBlob> {
        const blobObject = await this.readObject(hash);
        if (blobObject.type !== TObjectType.BLOB)
            throw new Error(`Object ${hash} is not a blob object`);

        return blobObject as TBlob;
    }

    async readObject(hash: string): Promise<TBlob | TTree | TCommit> {
        if (this._objects.has(hash))
            return this._objects.get(hash) as TBlob | TTree | TCommit;

        const [objectType, _, content] = await this._readObjectHeader(hash);

        switch(objectType as TObjectType) {
            case TObjectType.BLOB:
                const blob = TBlob.deserialize(content);
                blob.hash = this.hashObject(blob);
                this._objects.set(hash, blob);
                return blob;
            case TObjectType.TREE:
                const tree = TTree.deserialize(content);
                tree.hash = this.hashObject(tree);
                this._objects.set(hash, tree);
                return tree;
            case TObjectType.COMMIT:
                const commit = TCommit.deserialize(content);
                commit.hash = this.hashObject(commit);
                this._objects.set(hash, commit);
                return commit;
            default:
                throw new Error(`Unknown type ${ objectType } for object ${ hash }`);
        }
    } 

    async treeDiff(aCommitHash: string, bCommitHash: string, pathFilter: PathFilter = new PathFilter()) {
        const treeDiff = new TreeDiff(this);
        const commitObjectA = await this.loadCommit(aCommitHash);
        const commitObjectB = await this.loadCommit(bCommitHash);
        return await treeDiff.compareTrees(commitObjectA.treeHash, commitObjectB.treeHash);
    }

    _serializeObject(obj: TObject) {
        const content = obj.serialize();
        return Buffer.concat([Buffer.from(`${ obj.type } ${ content.byteLength }${ NULL_BYTE }`), content]);
    }

    private _eachFilename(pathname: string): string[] {
        return pathname.split("/").filter(Boolean);
    }

    private async _readObjectHeader(hash: string): Promise<[string, number, Buffer]> {
        const objectFilePath = this._objectPath(hash);

        if (!objectFilePath || !FileSystem.exists(objectFilePath))
            throw new Error(`Object ${hash} not found`);

        const chunks: Buffer[] = [];
        const collectStream = new Writable({
            write(chunk, encoding, callback) {
                chunks.push(chunk);
                callback();
            }
        });

        await pipeline(
            createReadStream(objectFilePath),
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

    // Create the directory structure (e.g., .git/objects/ab/cdefgh...)
    private _objectPath(hash: string) {
        return join(this._objectsFolderPath, hash.substring(0, 2), hash.substring(2));
    }
}