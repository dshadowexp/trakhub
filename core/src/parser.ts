import { Init } from "./cmds/init";
import { HashObject } from "./cmds/hash-object";
import { CatFile } from "./cmds/cat-file";
import { LsTree } from "./cmds/ls-tree";
import { Add } from "./cmds/add";
import { Rm } from "./cmds/rm";
import { LsFiles } from "./cmds/ls-files";
import { WriteTree } from "./cmds/write-tree";
import { CommitTree } from "./cmds/commit-tree";
import { Commit } from "./cmds/commit";
import { Log } from "./cmds/log";
import { Status } from "./cmds/status";
import { Diff } from "./cmds/diff";
import { Branch } from "./cmds/branch";
import { Checkout } from "./cmds/checkout";
import { Config } from "./cmds/config";
import { Fetch } from "./cmds/fetch";
import { Merge } from "./cmds/merge";

import commandLineArgs from 'command-line-args';
import type { BaseCommand } from "./cmds/-base";

export async function parse() {
    const mainDefinitions = [
        { name: 'command', defaultOption: true }
    ];
    const mainOptions = commandLineArgs(mainDefinitions, { stopAtFirstUnknown: true })
    const argv = mainOptions._unknown || []

    let command: BaseCommand<any> | undefined;
    if (mainOptions.command === 'init') {
        command = new Init(argv);
    } else if (mainOptions.command === 'hash-object') {
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
    } else if (mainOptions.command === 'write-tree') {
        command = new WriteTree(argv);
    } else if (mainOptions.command === 'ls-tree') {
        command = new LsTree(argv);
    } else if (mainOptions.command === 'commit-tree') {
        command = new CommitTree(argv);
    } else if (mainOptions.command === 'commit') {
        command = new Commit(argv);
    } else if (mainOptions.command === 'status') {
        command = new Status(argv)
    } else if (mainOptions.command === 'diff') {
        command = new Diff(argv);
    } else if (mainOptions.command === 'branch') {
        command = new Branch(argv);
    } else if (mainOptions.command === 'log') {
        command = new Log(argv);
    } else if (mainOptions.command === 'checkout') {
        command = new Checkout(argv);
    }

    if (command) 
        await command.run();
}

