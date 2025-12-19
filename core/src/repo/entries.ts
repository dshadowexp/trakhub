import { basename, isAbsolute, join, resolve, sep } from "path";
import type { Stats } from "fs";
import { UnixFileModeEnum } from "../types";

const MAX_PATH_SIZE = 0xfff;

export class BaseEntry {
    constructor(private _hash: string, private _mode: string) {}

    get hash(): string { return this._hash; }
    get mode(): string { return this._mode; }

    isTree(): boolean {
        return this._mode === UnixFileModeEnum.DIR;
    }
}

export class Entry extends BaseEntry {
    constructor(
        private _name: string, 
        _hash: string, 
        _mode: string = UnixFileModeEnum.REGULAR_FILE, 
        protected _stats: Stats | null = null
    ) {
        super(_hash, _mode);
    }
    
    get path(): string { return this._name; }
    get basename(): string { return basename(this._name); }

    parentDirectories(): string[] {
        const parts = this._name.split(sep).filter(Boolean);

        const parents: string[] = [];
        let current = isAbsolute(this._name) ? sep : "";

        for (let i = 0; i < parts.length - 1; i++) {
            current = join(current, parts[i]);
            parents.push(current)
        }

        return parents;
    }

    static modeForStat(stats: Stats) {
        return stats.isSymbolicLink() ? UnixFileModeEnum.SYMBOLIC_LINK : (stats.mode & 0o111) !== 0 ? UnixFileModeEnum.EXECUTABLE_FILE : UnixFileModeEnum.REGULAR_FILE;
    }
}

export class TreeEntry extends Entry {
    constructor(name: string, hash: string, _mode: string = UnixFileModeEnum.REGULAR_FILE) {
        super(name, hash, _mode, null);
    }

    static fromIndex(entry: IndexEntry) {
        return new TreeEntry(entry.path, entry.hash, entry.mode);
    }
}

export class IndexEntry extends Entry {
    constructor(
        private _ctimeSec: number,
        private _ctimeNano: number,
        private _mtimeSec: number,
        private _mtimeNano: number,
        private _dev: number,
        private _ino: number,
        mode: string,
        private _uid: number,
        private _gid: number,
        private _size: number,
        private _flags: number,
        _sha1: Buffer, 
        _path: string, 
        _stats: Stats | null = null
    ) {
        super(_path, _sha1.toString('hex'), mode, _stats);
    }

    get ctimeSec(): number { return this._ctimeSec; }
    get ctimeNano(): number { return this._ctimeNano; }
    get mtimeSec(): number { return this._mtimeSec; }
    get mtimeNano(): number { return this._mtimeNano; }
    get dev(): number { return this._dev; }
    get ino(): number { return this._ino; }
    get uid(): number { return this._uid; }
    get gid(): number { return this._gid; }
    get size(): number { return this._size; }
    get flags(): number { return this._flags; }
    get stage(): number { return (this._flags >> 12) & 0x3; }
    get key(): string { return `${ this.path }.${ this.stage }`; }
    
    updateStat(stats: Stats) {
        this._ctimeSec =  Math.floor(stats.ctime.getTime() / 1000);
        this._ctimeNano = stats.ctime.getMilliseconds();
        this._mtimeSec = Math.floor(stats.mtime.getTime() / 1000);
        this._mtimeNano = stats.mtime.getMilliseconds();
        this._dev = stats.dev;
        this._ino = stats.ino;
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

    statMatch(stat: Stats) {
        return (
            this.mode === Entry.modeForStat(stat) &&
            (this._size === 0 || this._size === stat.size)
        );
    }

    static create(path: string, hash: string, stats: Stats): IndexEntry {
        const mode = Entry.modeForStat(stats);
        const flags = Math.min(Buffer.from(path).byteLength, MAX_PATH_SIZE);
        
        // Return the values of the index entry
        return new IndexEntry(
            Math.floor(stats.ctime.getTime() / 1000),
            stats.ctime.getMilliseconds(),
            Math.floor(stats.mtime.getTime() / 1000),
            stats.mtime.getMilliseconds(),
            stats.dev,
            stats.ino,
            mode,
            stats.uid,
            stats.gid,
            stats.size,
            flags,
            Buffer.from(hash, "hex"),
            path,
            stats
        );
    }

    static createFromDb(path: string, item: BaseEntry, n: number) {
        return new IndexEntry(
            0,
            0,
            0,
            0,
            0,
            0,
            item.mode!,
            0,
            0,
            0,
            ( n << 12) | Math.min(Buffer.from(path).byteLength, MAX_PATH_SIZE),
            Buffer.from(item.hash, "hex"),
            path,
        );
    }
}