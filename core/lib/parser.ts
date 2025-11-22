import { commitCommand, hashObjectCommand, initCommand } from "./commands";

export async function parse(args: string[]) {
    // for (let i = 0; i < args.length; i++) {
    //     var arg = args[i];
	// 	var key;
	// 	var next;

    //     if ()
    // }

    if (args[0] === 'init') {
        await initCommand(args[1]);
    } if (args[0] === 'hash-object') {
        await hashObjectCommand(args[1]);
    } else if (args[0] === 'ls-tree') {

    } else if (args[0] === 'commit') {
        await commitCommand();
    }
}