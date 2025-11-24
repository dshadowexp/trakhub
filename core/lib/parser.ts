import { createRepo, catFile, hashObject, add, commit, lsTree, log, checkout, branch } from "./commands";
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
            await commit(args[1], author);
        } else if (args[0] === 'checkout') {

            const name = args.slice(1).length > 1 ? args[2] : args[1];
            const option = args.slice(1).length > 1;
            if (!name) {
                await checkout();
                return;
            }
            await checkout(name, option);
        } else if (args[0] === 'branch') {

            const name = args.slice(1).length > 1 ? args[2] : args[1];
            const option = args.slice(1).length > 1;
  
            await branch(name, option)
        } else if (args[0] === 'log') {
            await log();
        }
    } catch (error) {
        console.log(error);
    }
}