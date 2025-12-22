import { createHash } from "crypto";
import { FileSystem } from "../lib/standard";
import { IndexEntry } from "./entries";
import type { Stats } from "fs";

const HEADER_SIZE = 12;
const SIGNATURE = "DIRC";

export class TIndex {
    static VERSION = 2;

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

    get size(): number {
        return this._entries.size;
    }

    get changed(): boolean {
        return this._changed;
    }

    *eachEntry(): IterableIterator<IndexEntry> {
        yield* this._entries.values();
    }

    entryForPath(path: string) {
        return this._entries.get(`${ path }.0`);
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

    isTrackedFile(path: string): boolean {
        return [0, 1, 2, 3].some((value) => this._entries.has(`${ path }.${ value }`));
    }

    isTracked(path: string): boolean {
        return ( this.isTrackedFile(path) || this._parents.has(path) );
    }

    updateEntryStat(entry: IndexEntry, stat: Stats | undefined) {
        if (!stat)
            return;
        entry.updateStat(stat);
    }

    private _storeEntry(entry: IndexEntry) {
        this._keys.add(entry.key);
        this._entries.set(entry.key, entry);
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
        const entry = this._entries.get(`${ path }.0`); // do not hard code
        if (!entry) return;

        this._keys.delete(entry.key);
        this._entries.delete(entry.key);
        

        for (const dirname of entry.parentDirectories()) {
            const children = this._parents.get(dirname);
            if (!children) continue;
        
            children.delete(entry.path);
        
            if (children.size === 0) {
                this._parents.delete(dirname);
            }
        }
    }

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
        if (version !== TIndex.VERSION) throw new Error(`Unsupported index version ${version}`);

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
            // console.log('load print=====', sha1.toString('hex'));

            // Build entry object
            entries.push(new IndexEntry(
                ctimeSec,
                ctimeNano,
                mtimeSec,
                mtimeNano,
                dev,
                ino,
                mode.toString(),
                uid,
                gid,
                size,
                flags,
                sha1,
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

        entries.sort((a, b) => a.path.localeCompare(b.path));

        entries.forEach(entry => {
            this._entries.set(entry.key, entry);
        });
    }

    /**
     * 
     * @param repo 
     * @returns 
     */
    async save(): Promise<void> {
        const packedEntries: Buffer[] = [];

        for (const entry of this._entries.values()) {
            // --- Build the 62-byte header ---
            const head = Buffer.alloc(62);

            this._writeUInt32BE(entry.ctimeSec, head, 0);
            this._writeUInt32BE(entry.ctimeNano, head, 4);
            this._writeUInt32BE(entry.mtimeSec, head, 8);
            this._writeUInt32BE(entry.mtimeNano, head, 12);
            this._writeUInt32BE(entry.dev, head, 16);
            this._writeUInt32BE(entry.ino, head, 20);
            this._writeUInt32BE(parseInt(entry.mode), head, 24);
            this._writeUInt32BE(entry.uid, head, 28);
            this._writeUInt32BE(entry.gid, head, 32);
            this._writeUInt32BE(entry.size, head, 36);

            // sha1 (20 bytes)
            // console.log('save print =====', entry.hash);
            Buffer.from(entry.hash, 'hex').copy(head, 40);

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
        header.writeUInt32BE(TIndex.VERSION, 4);           // version 2
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

