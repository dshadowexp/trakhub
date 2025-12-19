export const NULL_BYTE: string = "\0";
export const NULL_PATH = "/dev/null";
export const NULL_OID = "0".repeat(40);

export const INVALID_BRANCH_NAME = new RegExp(
  [
      "^\\.",                 // starts with dot
      "\\/\\.",               // contains "/."
      "\\.\\.",               // contains ".."
      "^\\/",                 // starts with slash
      "\\/$",                 // ends with slash
      "\\.lock$",             // ends with ".lock"
      "@\\{",                 // contains "@{"
      "[\\x00-\\x20*:?[\\\\\\]^~\\x7f]" // illegal characters
  ].join("|")
);

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

export enum UnixFileModeEnum {
    REGULAR_FILE = "100644",
    EXECUTABLE_FILE = "100755",
    SYMBOLIC_LINK = "120000",
    DIR = "040000",
}

export enum DiffField {
   INDEX = "index",
   WORKSPACE = "workspace" 
}

export enum DiffAction {
    ADD = "add",
    DELETE = "delete",
    MODIFY = "modify",
    UNTRACKED = "untracked"
}

export type DirTree = { [name: string]: DirTree | string };

export type TrakTreeEntry = { mode: string, name: string, oid: string };





