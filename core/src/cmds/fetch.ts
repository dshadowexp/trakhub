import type { TCommit } from "../repo/objects";
import { Refspec, TRemotes } from "../repo/refs";
import { Terminal } from "../lib/standard";
import { RemoteAgent } from "../remote/agent";
import { HEADER_SIGNATURE } from "../remote/pack";
import type { Protocol } from "../remote/protocol";
import { recvPackedObjects } from "../remote/util";
import { TrakRepository } from "../repository";
import { BaseCommand } from "./-base";

const UPLOAD_PACK = "git-upload-pack";

interface FetchArgs {
    name?: string
    url?: string
    force?: boolean
    uploadPack?: string
}

export class Fetch extends BaseCommand<FetchArgs> {
    private _agent: RemoteAgent;

    constructor(args: any[] = []) {
        super(
            'clone', 
            'lists the contents of a tree object',
            [
                { name: 'name', type: String, multiple: false, defaultOption: true },
                { name: 'url', type: String },
                { name: 'force', alias: 'f', type: Boolean },
                { name: 'uploadPack', alias: 'u', type: String },
            ],
            args
        );
        this._agent = new RemoteAgent(this._repo!);
    }

    async run(): Promise<void> {

        const { fetchUrl, uploader, fetchSpecs } = await this._configure();
        console.log(fetchUrl, uploader, fetchSpecs); 
        
        await this._agent.startAgent("fetch", uploader, fetchUrl, fetchSpecs);
        await this._agent.recvReferences();
        const localRefs = await this._sendWantList(fetchSpecs);
        await this._sendHaveList();
        await this._recvObjects();
        this._updateRemoteRefs(fetchUrl, localRefs);

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

    private async _configure() {
        const name = this._args.name ?? TRemotes.DEFAULT_REMOTE;
        const remote = await TRemotes.get(name);
        const fetchUrl = remote?.fetchUrl || this._args.url || '';
        const uploader = this._args.uploadPack || remote?.uploader || UPLOAD_PACK;
        const fetchSpecs = remote?.fetchSpecs || [];
        return { fetchUrl, uploader, fetchSpecs };
    }

    private async _sendWantList(fetchSpecs: string[]) {
        const targets = Refspec.expand(fetchSpecs, Object.keys(this._agent.remoteRefs));
        const wanted = new Set<string>();
        const localRefs: Record<string, string> = {};
    
        for (const [target, [source, forced]] of Object.entries(targets)) {
            const localOid = await this._repo!.refs.readRef(target);
            const remoteOid = this._agent.remoteRefs[source];
    
            if (localOid === remoteOid)
                continue;
    
            localRefs[target] = localOid!;
            wanted.add(remoteOid);
        }
    
        wanted.forEach(oid => {
            this._agent.conn?.sendPktLine(`want ${ oid }`);
        });
    
        this._agent.conn?.sendPktLine(null);
        if (wanted.size === 0)
            process.exit(0);
    
        return localRefs;
    }

    private async _sendHaveList() {
        const revList: TCommit[] = []; // ::RevList.new(repo, [], options)
        revList.forEach(commit => {
            this._agent.conn?.sendPktLine(`have ${ commit.hash }`);
        })

        this._agent.conn?.sendPktLine("done");
        this._agent.conn?.recvUntil(HEADER_SIGNATURE)
    }

    private async _recvObjects() {
        await recvPackedObjects(this._repo!, this._agent, HEADER_SIGNATURE);
    }

    private _updateRemoteRefs(fetchUrl: string, localRefs: Record<string, string>) {
        Terminal.printerr(`From ${ fetchUrl }`);

        const errors = [];
        
    }
}




// const fetchRefs = async (trakUrl: string) => {
//     try {
//         const response = await fetch(
//             `${trakUrl}/info/refs?service=git-upload-pack`,
//             { method: "GET" }
//         );

//         if (!response.ok) {
//             throw new Error(`HTTP ${response.status}`);
//         }

//         const text = await response.text();
//         const [additions, ...refs] = text.split("\n").slice(1, -1);
//         const capabilities = additions.split("\0")[1].split(" ");
//         const symref = capabilities.find((cap) => cap.startsWith("symref=HEAD:"));

//         return {
//             capabilities,
//             HEAD: symref?.split("symref=HEAD:")[1] || "",
//             data: refs.map((ref) => {
//                 const [hash, name] = ref.split(" ");

//                 // the first 4 bytes represent the size of the entire string
//                 return { hash: hash.slice(4), ref: name };
//             }),
//         };
//     } catch (error) {
//         console.error(error);
//     }

//     return null;
// };

