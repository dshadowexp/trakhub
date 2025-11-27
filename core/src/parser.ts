
import { add } from "./cmds/add";
import { branch } from "./cmds/branch";
import { catFile } from "./cmds/cat-file";
import { checkout } from "./cmds/checkout";
import { commit } from "./cmds/commit";
import { hashObject } from "./cmds/hash-object";
import { createRepo } from "./cmds/init";
import { log } from "./cmds/log";
import { lsTree } from "./cmds/ls-tree";
import { status } from "./cmds/status";
import { TrakAuthor } from "./types";


export async function parse(args: string[]) {
    try {
        if (args[0] === 'init') {
            await createRepo('.');
        } else if (args[0] === 'cat-file') {
            await catFile(args[1]);
        } else if (args[0] === 'hash-object') {
            await hashObject(args[2], args[1], true);
        } else if (args[0] === 'ls-tree') {
            await lsTree(args[1]);
        } else if (args[0] === 'add') {
            await add(args[1]);
        } else if (args[0] === 'commit') {
            const author = new TrakAuthor('Trak User', 'user@trak.com');
            await commit(args[1], author, author);
        } else if (args[0] === 'log') {
            await log();
        } else if (args[0] === 'checkout') {
            const name = args.slice(1).length > 1 ? args[2] : args[1];
            const option = args.slice(1).length > 1;
            await checkout(name, option);
        } else if (args[0] === 'branch') {
            const name = args.slice(1).length > 1 ? args[2] : args[1];
            const option = args.slice(1).length > 1;
  
            await branch(name, option)
        } else if (args[0] === 'status') {
            await status();
        } else if (args[0] === 'merge') {

        } else if (args[0] === 'clone') {

        } else if (args[0] === 'pull') {

        } else if (args[0] === 'push') {

        }
    } catch (error) {
        console.log(error);
    }
}