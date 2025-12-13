import { add } from "./cmds/add";
import { branch } from "./cmds/branch";
import { catFile } from "./cmds/cat-file";
import { checkout } from "./cmds/checkout";
import { commit } from "./cmds/commit";
import { commitTree } from "./cmds/commit-tree";
import { config } from "./cmds/config";
import { diff } from "./cmds/diff";
import { hashObject } from "./cmds/hash-object";
import { createRepo } from "./cmds/init";
import { log } from "./cmds/log";
import { lsFiles } from "./cmds/ls-files";
import { lsTree } from "./cmds/ls-tree";
import { merge } from "./cmds/merge";
import { rm } from "./cmds/rm";
import { status } from "./cmds/status";
import { writeTree } from "./cmds/write-tree";
import { TrakObjectTypeEnum } from "./types";

export async function parse(args: string[]) {
    try {
        if (args[0] === 'init') {
            await createRepo('.');
        } else if (args[0] === 'cat-file') {
            await catFile(args[1]);
        } else if (args[0] === 'hash-object') {
            await hashObject(args[2], args[1] as TrakObjectTypeEnum, true);
        } else if (args[0] === 'ls-tree') {
            await lsTree(args[1]);
        } else if (args[0] === 'ls-files') {
            await lsFiles({stage: true});
        } else if (args[0] === 'add') {
            await add([args[1]]);
        } else if (args[0] === 'rm') {
            await rm([args[1]]);
        } else if (args[0] === 'write-tree') {
            await writeTree();
        } else if (args[0] === 'commit-tree') {
            await commitTree({ treeHash: args[1], parents: [], message: args[2] })
        } else if (args[0] === 'commit') {
            await commit(args[1]);
        } else if (args[0] === 'log') {
            await log();
        } else if (args[0] === 'status') {
            await status();
        }  else if (args[0] === 'branch') {
            const name = args[1];
  
            await branch(name, {
                list: true,
                verbose: true, 
                delete: false,
                forceDelete: false, 
                create: false,
                // startPoint: null
            })
        } else if (args[0] === 'diff') {
            await diff();
        } else if (args[0] === 'checkout') {
            const name = args.slice(1).length > 1 ? args[2] : args[1];
            const option = args.slice(1).length > 1;
            await checkout(name, {
                createBranch: false,
                // startPoint: ''
            });
        } else if (args[0] === 'merge') {
            const name = args.slice(1).length > 1 ? args[2] : args[1];
            await merge(name);
        } else if (args[0] === 'config') {
            await config({ 
                key: "remote.upstream.fetch", 
                //unset: true
                value: "+refs/heads/*:refs/remotes/origin/*", 
                //level: 'local'
                // list: true,
                //showOrigin: true
            });
        } else if (args[0] === 'remote') {

        } else if (args[0] === 'pull') {

        } else if (args[0] === 'push') {

        }
    } catch (error) {
        console.log(error);
    }
}

