export enum PackFileObjectTypeEnum {
  RESERVED_0,
  COMMIT,
  TREE,
  BLOB,
  TAG,
  RESERVED_5,
  OFS_DELTA,
  REF_DELTA,
}

export enum TrakObjectTypeEnum {
    COMMIT = "commit",
    TREE = "tree",
    BLOB = "blob",
}

export enum UnixFileModeEnum {
    REGULAR_FILE = "100644",
    EXECUTABLE_FILE = "100755",
    SYMBOLIC_LINK = "120000",
    DIR = "040000",
}

export type DirTree = { [name: string]: DirTree | string };

export type TrakTreeEntry = { mode: string, name: string, oid: string };



export class TrakAuthor {
    constructor(private _name: string, private _email: string, private _timestamp: number = 0) {
        this._timestamp = this._timestamp == 0 ? this._initTimestamp() : this._timestamp;
    }

    get timestamp(): number {
        return this._timestamp;
    }

    private _initTimestamp(): number {
        return Math.floor((new Date()).getTime() / 1000);
    }

    serialize(): string {
        return `${ this._name } <${ this._email }>`;
    }
}


