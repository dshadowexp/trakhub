import commandLineArgs from "command-line-args";
import { TrakRepository } from "./repository";
import { TRepository } from "./repo/repository";

export const NULL_BYTE: string = "\0";
export const NULL_PATH = "/dev/null";
export const NULL_OID = "0".repeat(40);

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

export type EntryInfo = {
    oid?: string;
    mode?: string;
}

export enum UnixFileModeEnum {
    REGULAR_FILE = "100644",
    EXECUTABLE_FILE = "100755",
    SYMBOLIC_LINK = "120000",
    DIR = "040000",
}

export type DirTree = { [name: string]: DirTree | string };

export type TrakTreeEntry = { mode: string, name: string, oid: string };

export class BaseCommand<T> {
    protected _args: T;
    protected _repo: TRepository | null = null;

    constructor(private _name: string, private _description: string, _options: any, argv: any[] = [], initRepo: boolean = true) {
        this._args = this._initialize(_options, argv);
        if (initRepo)
            this._repo = TRepository.repoFind();
    }

    private _initialize<T>(options: any, argv: any[]): T {
        return commandLineArgs(options, { argv }) as T;
    }
    
    execute(): Promise<void> {
        throw new Error("Method not implemented.");
    }
}


