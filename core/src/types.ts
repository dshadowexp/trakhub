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





