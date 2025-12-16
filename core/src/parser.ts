import { HashObject } from "./cmds/hash-object";
import { CatFile } from "./cmds/cat-file";
import { LsTree } from "./cmds/ls-tree";
import { Add } from "./cmds/add";
import { Rm } from "./cmds/rm";
import { LsFiles } from "./cmds/ls-files";
import { writeTree } from "./cmds/write-tree";
import { commit } from "./cmds/commit";
import { commitTree } from "./cmds/commit-tree";

import { Branch } from "./cmds/branch";
import { checkout } from "./cmds/checkout";

import { config } from "./cmds/config";
import { diff } from "./cmds/diff";
import { fetch } from "./cmds/fetch";
import { createRepo } from "./cmds/init";
import { log } from "./cmds/log";

import { merge } from "./cmds/merge";

import { status } from "./cmds/status";

import commandLineArgs from 'command-line-args';
import type { BaseCommand } from "./types";

export async function parse(args: string[]) {
    const mainDefinitions = [
        { name: 'command', defaultOption: true }
    ];
    const mainOptions = commandLineArgs(mainDefinitions, { stopAtFirstUnknown: true })
    const argv = mainOptions._unknown || []

    // console.log('mainOptions\n===========')
    // console.log(mainOptions)
    let command: BaseCommand<any> | undefined;
    if (mainOptions.command === 'hash-object') {
        command = new HashObject(argv);
    } else if (mainOptions.command === 'cat-file') {
        command = new CatFile(argv);
    } else if (mainOptions.command === 'ls-tree') {
        command = new LsTree(argv);
    } else if (mainOptions.command === 'add') {
        command = new Add(argv);
    } else if (mainOptions.command === 'rm') {
        command = new Rm(argv);
    } else if (mainOptions.command === 'ls-files') {
        command = new LsFiles(argv);
    }
    
    else if (mainOptions.command === 'branch') {
        command = new Branch(argv);
    }  

    if (command) await command.execute();


    // try {
    //     if (args[0] === 'init') {
    //         await createRepo('.');
    //     } else if (args[0] === 'cat-file') {
    //         await catFile(args[1]);
    //     } else if (args[0] === 'hash-object') {
    //         await hashObject(args[2], args[1], true);
    //     } else if (args[0] === 'ls-tree') {
    //         await lsTree(args[1]);
    //     } else if (args[0] === 'ls-files') {
    //         await lsFiles({stage: true});
    //     } else if (args[0] === 'add') {
    //         await add([args[1]]);
    //     } else if (args[0] === 'rm') {
    //         await rm([args[1]]);
    //     } else if (args[0] === 'write-tree') {
    //         await writeTree();
    //     } else if (args[0] === 'commit-tree') {
    //         await commitTree({ treeHash: args[1], parents: [], message: args[2] })
    //     } else if (args[0] === 'commit') {
    //         await commit(args[1]);
    //     } else if (args[0] === 'log') {
    //         await log();
    //     } else if (args[0] === 'status') {
    //         await status();
    //     }  else if (args[0] === 'branch') {
    //         const name = args[1];
    //         console.log(args);

    //         await branch(name, {
    //             list: true,
    //             verbose: true, 
    //             delete: false,
    //             forceDelete: false, 
    //             create: false,
    //             // startPoint: null
    //         })
    //     } else if (args[0] === 'diff') {
    //         await diff();
    //     } else if (args[0] === 'checkout') {
    //         const name = args.slice(1).length > 1 ? args[2] : args[1];
    //         const option = args.slice(1).length > 1;
    //         await checkout(name, {
    //             createBranch: false,
    //             // startPoint: ''
    //         });
    //     } else if (args[0] === 'merge') {
    //         const name = args.slice(1).length > 1 ? args[2] : args[1];
    //         await merge(name);
    //     } else if (args[0] === 'config') {
    //         await config({ 
    //             key: "remote.origin.url", 
    //             //unset: true
    //             // value: "+refs/heads/*:refs/remotes/origin/*", 
    //             //level: 'local'
    //             // list: true,
    //             //showOrigin: true
    //         });
    //     } else if (args[0] === 'remote') {

    //     } else if (args[0] === 'fetch') {
    //         await fetch({});
    //     } else if (args[0] === 'upload-pack') {

    //     } else if (args[0] === 'pull') {

    //     } else if (args[0] === 'push') {

    //     }
    // } catch (error) {
    //     console.log(error);
    // }
}

