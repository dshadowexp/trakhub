import { TrakRemotes } from "../db/refs";
import { Terminal } from "../lib/standard";
import { TrakRepository } from "../repository";

interface RemoteArgs {
    verbose?: boolean
    subCommand?: 'add' | 'remove'
    name?: string
    url?: string
}

export async function remote(args: RemoteArgs) {
    const repo = await TrakRepository.repoFind();
    if (!repo) {
        Terminal.println("fatal: not in a trak repository");
        return;
    }

    switch (args.subCommand) {
        case 'add':
            await addRemote(repo, args.name!, args.url!);
            break;
        case 'remove':
            await removeRemote(args.name!);
            break;
        default:
            await listRemotes(args.verbose);
            break;
    }
}

async function addRemote(repo: TrakRepository, name: string, url: string) {
    try {
        await TrakRemotes.add(repo, name, url, []);
        process.exit(0);
    } catch (error) {
        Terminal.printerr(`"fatal: ${ (error as Error).message }`);
        process.exit(128);
    }
}

async function removeRemote(name: string) {
    try {
        await TrakRemotes.remove(name);
        process.exit(0);
    } catch (error) {
        Terminal.printerr(`"fatal: ${ (error as Error).message }`);
        process.exit(128);
    }
}

async function listRemotes(verbose: boolean | undefined) {
    const remotes = await TrakRemotes.listRemotes();
    await Promise.all(remotes.map(remote => _listRemote(remote, verbose)));
    process.exit(0);
}

async function _listRemote(name: string, verbose: boolean | undefined) {
    if (!verbose) {
        Terminal.println(name);
        return;
    }

    const remote = await TrakRemotes.get(name);
    if (!remote) return;

    Terminal.println(`${ name }\t${ remote.fetchUrl } (fetch)`);
    Terminal.println(`${ name }\t${ remote.pushUrl } (push)`);
}