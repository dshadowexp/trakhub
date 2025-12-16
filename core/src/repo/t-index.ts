import { basename, isAbsolute, resolve, join, sep } from "path";
import { FileSystem } from "../lib/standard";
import { createHash } from "crypto";
import type { EntryInfo } from "../types";
import type { Stats } from "fs";

const HEADER_SIZE = 12;
const SIGNATURE = "DIRC";
const MAX_PATH_SIZE = 0xfff;

export class TIndex {
    static version = 2;
    private static _entries: IndexEntry[] = [];
    private _entries: Map<string, IndexEntry>;
    private _keys: Set<string>;
    private _parents: Map<string, Set<string>>;
    private _changed: boolean;

    constructor(private _indexPath: string) {
        this._keys = new Set();
        this._entries = new Map();
        this._parents = new Map();
        this._changed = false;
    }

    *eachEntry(): IterableIterator<IndexEntry> {
        yield* this._entries.values();
    }

    add(path: string, hash: string, stats: Stats) {
        const entry = IndexEntry.create(path, hash, stats);
        this._discardConflicts(entry);
        this._storeEntry(entry);
        this._changed = true;
    }

    remove(path: string) {
        this._removeEntry(path);
        this._removeChildren(path);
        this._changed = true;
    }

    updateEntryStats(entry: IndexEntry, stats: Stats) {
        entry.updateStats(stats)
    }

    private _storeEntry(entry: IndexEntry) {
        this._keys.add(entry.key);
        this._entries.set(entry.key, entry);
        console.log(entry.key);
        console.log(this._entries.keys())
        entry.parentDirectories().forEach((dirname) => {
            if (!this._parents.has(dirname))
                this._parents.set(dirname, new Set());
            this._parents.get(dirname)!.add(entry.path);
        });
    }

    private _discardConflicts(entry: IndexEntry) {
        entry.parentDirectories().forEach((dirname) => {
            this._removeEntry(dirname);
        });
        this._removeChildren(entry.path);
    }

    private _removeChildren(path: string) {
        if (!this._parents.has(path)) return;
        const children = [...this._parents.get(path)!];
        children.forEach((child) => {
            this._removeEntry(child);
        });
    }

    private _removeEntry(path: string) {
        console.log('>>>>>>>>>>>>> inside remove entry')
        const entry = this._entries.get(path);
        if (!entry) return;

        this._keys.delete(entry.key);
        this._entries.delete(entry.key);
        console.log(entry.key);
        console.log(this._entries.keys())

        for (const dirname of entry.parentDirectories()) {
            const children = this._parents.get(dirname);
            if (!children) continue;
        
            children.delete(entry.path);
        
            if (children.size === 0) {
                this._parents.delete(dirname);
            }
        }
    }

    static get entries(): IndexEntry[] {
        return this._entries;
    }

    static getEntry(path: string, stage: number = 0): IndexEntry | undefined {
        return this._entries.find(value => value.path === path && value.stage === stage);
    }

    static hasConflicts(): boolean {
        return this.entries.some(value => value.stage > 0);
    }

    static isTrackedFile(path: string): boolean {
        return [0, 1, 2, 3].some((value) => this.getEntry(path, value) !== undefined);
    }

    static isTrackDirectory(path: string): boolean {
        return false;
    }

    private static _removeWithStage(path: string, stage: number) {
        this._entries = this._entries.filter(entry => entry.path !== path || entry.stage !== stage);
    }

    static addEntry(path: string, hash: string, stats: Stats) {
        console.log(`+>>>>Index adding - ${ path }`);
        // Remove all stages for this path
        [1, 2, 3].forEach((value) => {
            this._removeWithStage(path, value);
        });

        // Only add if the path doesn't exist in any remaining entries
        const exists = this._entries.some(entry => entry.path === path);
        if (!exists) {
            const entry = IndexEntry.create(path, hash, stats);
            this._entries.push(entry);
        }
    }

    static removeEntry(path: string) {
        console.log(`-<<<<<Index removing - ${ path }`);
        [0, 1, 2, 3].forEach((value) => {
            this._removeWithStage(path, value);
        });
        console.log(this.getFilePaths());
    }
    
    static addConflictSet(path: string, items: (EntryInfo | undefined)[]) {
        this._removeWithStage(path, 0);
        items.forEach((item, n) => {
            if (!item) return;
            const entry = IndexEntry.createFromDb(path, item, n + 1);
            this._entries.push(entry);
        });
    }

    static addFromDb(path: string, item: EntryInfo) {
        const entry = IndexEntry.createFromDb(path, item, 0);
        this._entries.push(entry);
    }

    static getFilePaths(): string[] {
        return [...new Set(this._entries.map(value => value.path))];
    }

    /**
     * 
     * @param repo 
     * @returns 
     */
    async load(): Promise<void> {
        if (!FileSystem.exists(this._indexPath))
            return;

        const data = await FileSystem.readFile(this._indexPath);

        // --- Verify SHA-1 checksum ---
        const fileWithoutChecksum = data.subarray(0, data.length - 20);
        const checksum = data.subarray(data.length - 20);

        const actualDigest = createHash("sha1").update(fileWithoutChecksum).digest();

        if (!actualDigest.equals(checksum)) throw new Error("Invalid index checksum");

        // --- Header ---
        const signature = data.subarray(0, 4).toString("ascii");
        const version = data.readUInt32BE(4);
        const numEntries = data.readUInt32BE(8);

        if (signature !== SIGNATURE) throw new Error("Invalid index signature");
        if (version !== TIndex.version) throw new Error(`Unsupported index version ${version}`);

        const entries: IndexEntry[] = [];

        let offset = 12;                          // start of entries
        const end = data.length - 20;             // before checksum

        while (offset + 62 < end && entries.length < numEntries) {
            // Parse fixed fields (62 bytes)
            const fieldsEnd = offset + 62;
            const fixed = data.subarray(offset, fieldsEnd);

            const ctimeSec = this._readUInt32BE(fixed, 0);
            const ctimeNano = this._readUInt32BE(fixed, 4);
            const mtimeSec = this._readUInt32BE(fixed, 8);
            const mtimeNano = this._readUInt32BE(fixed, 12);
            const dev = this._readUInt32BE(fixed, 16);
            const ino = this._readUInt32BE(fixed, 20);
            const mode = this._readUInt32BE(fixed, 24);
            const uid = this._readUInt32BE(fixed, 28);
            const gid = this._readUInt32BE(fixed, 32);
            const size = this._readUInt32BE(fixed, 36);
            const sha1 = fixed.subarray(40, 60);
            const flags = fixed.readUInt16BE(60);

            // Parse file path (null-terminated)
            let pathEnd = fieldsEnd;
            while (pathEnd < end && data[pathEnd] !== 0x00) {
                pathEnd++;
            }

            if (pathEnd >= end) throw new Error("Index path missing null terminator");

            const filePath = data.subarray(fieldsEnd, pathEnd).toString("utf8");

            // Build entry object
            entries.push(new IndexEntry(
                ctimeSec,
                ctimeNano,
                mtimeSec,
                mtimeNano,
                dev,
                ino,
                mode,
                uid,
                gid,
                size,
                sha1,
                flags,
                filePath,
            ));

            // Entry size with padding:
            const pathLength = pathEnd - fieldsEnd;
            const entryLength = Math.ceil((62 + pathLength + 1) / 8) * 8; // +1 for null

            offset += entryLength;
        }

        if (entries.length !== numEntries) {
            throw new Error("Index entry count mismatch");
        }

        entries.forEach(entry => {
            this._entries.set(entry.key, entry);
        });

        console.log(this._entries.keys())
    }

    /**
     * 
     * @param repo 
     * @returns 
     */
    async save(): Promise<void> {
        const packedEntries: Buffer[] = [];

        const entries = [...this._entries.values()].sort((a, b) =>
            a.path.localeCompare(b.path)
        );

        for (const entry of entries) {
            // --- Build the 62-byte header ---
            const head = Buffer.alloc(62);

            this._writeUInt32BE(entry.ctimeSec, head, 0);
            this._writeUInt32BE(entry.ctimeNano, head, 4);
            this._writeUInt32BE(entry.mtimeSec, head, 8);
            this._writeUInt32BE(entry.mtimeNano, head, 12);
            this._writeUInt32BE(entry.dev, head, 16);
            this._writeUInt32BE(entry.ino, head, 20);
            this._writeUInt32BE(entry.mode, head, 24);
            this._writeUInt32BE(entry.uid, head, 28);
            this._writeUInt32BE(entry.gid, head, 32);
            this._writeUInt32BE(entry.size, head, 36);

            // sha1 (20 bytes)
            entry.sha1.copy(head, 40);

            // flags (2 bytes, BE)
            head.writeUInt16BE(entry.flags, 60);

            // --- Path bytes ---
            const pathBytes = Buffer.from(entry.path);
            const pathLen = pathBytes.length;

            // --- Compute padded entry size ---
            const entryLength = Math.ceil((62 + pathLen + 1) / 8) * 8; // +1 for null

            const total = Buffer.alloc(entryLength);

            // 62-byte header
            head.copy(total, 0);

            // file path
            pathBytes.copy(total, 62);

            // null + padding already zero-filled because Buffer.alloc()

            packedEntries.push(total);
        }

        // --- HEADER (DIRC, version 2, entry count) ---
        const header = Buffer.alloc(HEADER_SIZE);
        header.write(SIGNATURE, 0, "ascii");
        header.writeUInt32BE(TIndex.version, 4);           // version 2
        header.writeUInt32BE(this._entries.size, 8);

        const allData = Buffer.concat([header, ...packedEntries]);

        // --- SHA-1 checksum ---
        const digest = createHash("sha1").update(allData).digest();

        // --- Write final file ---
        await FileSystem.writeFile(this._indexPath, Buffer.concat([allData, digest]));
    }

    clear() {
        this._entries = new Map();
        this._keys = new Set();
        this._parents = new Map();
        this._changed = false;
    }

    /**
     * 
     * @param repo 
     */
    static clear() {
        // _entries = new Map();
    }

    private _readUInt32BE(buf: Buffer, offset: number): number {
        return buf.readUInt32BE(offset);
    }

    private _writeUInt32BE(value: number, buffer: Buffer, offset: number) {
        buffer.writeUInt32BE(value, offset);
    }
}

export class IndexEntry {
    constructor(
        private _ctimeSec: number,
        private _ctimeNano: number,
        private _mtimeSec: number,
        private _mtimeNano: number,
        private _dev: number,
        private _ino: number,
        private _mode: number,
        private _uid: number,
        private _gid: number,
        private _size: number,
        private _sha1: Buffer,
        private _flags: number,
        private _path: string
    ) {}

    get ctimeSec(): number { return this._ctimeSec; }
    get ctimeNano(): number { return this._ctimeNano; }
    get mtimeSec(): number { return this._mtimeSec; }
    get mtimeNano(): number { return this._mtimeNano; }
    get dev(): number { return this._dev; }
    get ino(): number { return this._ino; }
    get mode(): number { return this._mode; }
    get uid(): number { return this._uid; }
    get gid(): number { return this._gid; }
    get size(): number { return this._size; }
    get sha1(): Buffer { return this._sha1; }
    get flags(): number { return this._flags; }
    get path(): string { return this._path; }
    get stage(): number { return (this._flags >> 12) & 0x3; }
    get key(): string { return `${ this.path }.${ this.stage }`; }
    get basename(): string { return basename(this._path); }
    
    parentDirectories(): string[] {
        const resolved = resolve(this._path);
        const parts = resolved.split(sep).filter(Boolean);

        const parents: string[] = [];
        let current = isAbsolute(resolved) ? sep : "";

        for (let i = 0; i < parts.length - 1; i++) {
            current = join(current, parts[i]);
            parents.push(current)
        }

        return parents;
    }

    updateStats(stats: Stats) {
        this._ctimeSec =  Math.floor(stats.ctime.getTime() / 1000);
        this._ctimeNano = stats.ctime.getMilliseconds();
        this._mtimeSec = Math.floor(stats.mtime.getTime() / 1000);
        this._mtimeNano = stats.mtime.getMilliseconds();
        this._dev = stats.dev;
        this._ino = stats.ino;
        this._mode = parseInt(FileSystem.mode(this._path));
        this._uid = stats.uid;
        this._gid = stats.gid;
        this._size = stats.size;
    }

    timesMatch(stats: Stats) {
        return (
            Math.floor(stats.ctime.getTime() / 1000) === this._ctimeSec &&
            stats.ctime.getMilliseconds() === this._ctimeNano &&
            Math.floor(stats.mtime.getTime() / 1000) === this._mtimeSec &&
            stats.mtime.getMilliseconds() === this._mtimeNano
        );
    }

    static create(path: string, hash: string, stats: Stats): IndexEntry {
        // Get file stats
        const flags = Math.min(Buffer.from(path).byteLength, MAX_PATH_SIZE);
        
        // Return the values of the index entry
        return new IndexEntry(
            Math.floor(stats.ctime.getTime() / 1000),
            stats.ctime.getMilliseconds(),
            Math.floor(stats.mtime.getTime() / 1000),
            stats.mtime.getMilliseconds(),
            stats.dev,
            stats.ino,
            parseInt(FileSystem.mode(path)),
            stats.uid,
            stats.gid,
            stats.size,
            Buffer.from(hash, "hex"),
            flags,
            path,
        );
    }

    static createFromDb(path: string, item: EntryInfo, n: number) {
        return new IndexEntry(
            0,
            0,
            0,
            0,
            0,
            0,
            parseInt(item.mode!),
            0,
            0,
            0,
            Buffer.from(item.oid!, "hex"),
            ( n << 12) | Math.min(Buffer.from(path).byteLength, MAX_PATH_SIZE),
            path,
        );
    }
}