import type { TrakObject } from "../db/objects";
import { Refspec, TrakRefs, TrakRemotes } from "../db/refs";
import { Terminal } from "../lib/standard";
import { RemoteAgent } from "../remote/agent";
import { HEADER_SIGNATURE } from "../remote/pack";
import type { Protocol } from "../remote/protocol";
import { recvPackedObjects } from "../remote/util";
import { TrakRepository } from "../repository";

const UPLOAD_PACK = "git-upload-pack";

interface FetchArgs {
    name?: string
    url?: string
    force?: boolean
    uploadPack?: string
}

export async function fetch(args: FetchArgs) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    const { fetchUrl, uploader, fetchSpecs } = await _configure([], args);
    console.log(fetchUrl, uploader, fetchSpecs); 
    const remoteAgent = new RemoteAgent(repo);
    await remoteAgent.startAgent("fetch", uploader, fetchUrl, fetchSpecs);
    // await remoteAgent.recvReferences();
    // const localRefs = await _sendWantList(repo, remoteAgent.conn, fetchSpecs, remoteAgent.remoteRefs);
    // await _sendHaveList(remoteAgent.conn);
    // await _recvObjects(repo, remoteAgent.conn);
    // _updateRemoteRefs(fetchUrl, localRefs);

    // TODO}
    /**
     * 
     * configure
     * start_agent("fetch", @uploader, @fetch_url)
     * recv_references
     * send_want_list
     * send_have_list
     * recv_objects
     * update_remote_refs
     * exit (@errors.empty? ? 0 : 1)
     */
    process.exit(0);
}

async function _configure(args: string[], options: FetchArgs) {
    const name = args[0] ?? TrakRemotes.DEFAULT_REMOTE;
    const remote = await TrakRemotes.get(name);
    const fetchUrl = remote?.fetchUrl || args[0];
    const uploader = options.uploadPack || remote?.uploader || UPLOAD_PACK;
    const fetchSpecs = args.length > 1 ? args.slice(1) : remote?.fetchSpecs || [];
    return { fetchUrl, uploader, fetchSpecs };
}

async function _sendWantList(repo: TrakRepository, conn: Protocol | undefined, fetchSpecs: string[], remoteRefs: Record<string, string>) {
    const targets = Refspec.expand(fetchSpecs, Object.keys(remoteRefs));
    const wanted = new Set<string>();
    const localRefs: Record<string, string> = {};

    for (const [target, [source, forced]] of Object.entries(targets)) {
        const localOid = await TrakRefs.readRef(repo, target);
        const remoteOid = remoteRefs[source];

        if (localOid === remoteOid)
            continue;

        localRefs[target] = localOid!;
        wanted.add(remoteOid);
    }

    wanted.forEach(oid => {
        conn?.sendPktLine(`want ${ oid }`);
    });

    conn?.sendPktLine(null);
    if (wanted.size === 0)
        process.exit(0);

    return localRefs;
}

async function _sendHaveList(conn: Protocol | undefined,) {
    const revList: TrakObject[] = []; // ::RevList.new(repo, [], options)
    revList.forEach(commit => {
        conn?.sendPktLine(`have ${ commit.hash() }`);
    })

    conn?.sendPktLine("done");
    conn?.recvUntil(HEADER_SIGNATURE)
}

async function _recvObjects(repo: TrakRepository, conn: Protocol | undefined,) {
    await recvPackedObjects(repo, conn, HEADER_SIGNATURE);
}

function _updateRemoteRefs(fetchUrl: string, localRefs: Record<string, string>) {
    Terminal.printerr(`From ${ fetchUrl }`);

    const errors = [];
    
}