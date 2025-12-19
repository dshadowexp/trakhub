import { RemoteAgent } from "../remote/agent";
import type { Protocol } from "../remote/protocol";
import { sendPackedObjects } from "../remote/util";
import { TrakRepository } from "../repository";
import { BaseCommand } from "./-base";

interface UploadPackArgs {
    force?: boolean
    uploadPack?: string
}

export class Remote extends BaseCommand<UploadPackArgs> {
    constructor(args: any[] = []) {
        super(
            'remote', 
            'lists the contents of a tree object',
            [
                { name: 'hash', type: String, multiple: false, defaultOption: true },
                { name: 'recursive', alias: 'r', type: Boolean },
            ],
            args
        )
    }

    async run(): Promise<void> {

    }
}

export async function uploadPack(args: UploadPackArgs) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    const remoteAgent = new RemoteAgent(repo);
    remoteAgent.acceptClient("upload-pack");
    await remoteAgent.sendReferences();
    const wanted = await _recvWantList(remoteAgent.conn);
    const remoteHas = await _recvHaveList(remoteAgent.conn);
    await _sendObjects(repo, remoteAgent.conn, Array.from(wanted), Array.from(remoteHas));
    process.exit(0);
}

async function _sendObjects(repo: TrakRepository, conn: Protocol | undefined, wanted: string[], remoteHas: string[]) {
    const revs = [
        ...wanted,
        ...remoteHas.map(oid => `^${oid}`)
    ];

    await sendPackedObjects(repo, conn, revs);
}

async function _recvHaveList(conn: Protocol | undefined,) {
    const remoteHas = await _recvOids(conn, "have", "done");
    conn?.sendPktLine("NAK");
    return remoteHas;
}

async function _recvWantList(conn: Protocol | undefined) {
    const wanted = await _recvOids(conn, "want", null);
    if (wanted.size === 0)
        process.exit(0)
    return wanted;
}

async function _recvOids(conn: Protocol | undefined, prefix: string, terminator: string | null) {
    const pattern = new RegExp(`^${prefix} ([0-9a-f]+)$`);
    const result = new Set<string>();

    for (const line of conn!.recvUntil(terminator)) {
        const match = line.match(pattern);
        
        if (!match) {
            console.warn(`Invalid OID line: ${line}`);
            continue;
        }

        result.add(match[1]);
    }

    return result;
}

