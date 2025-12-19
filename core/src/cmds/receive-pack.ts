import { RemoteAgent } from "../remote/agent";
import { BaseCommand } from "./-base";

const CAPABILITIES = ["no-thin", "report-status", "delete-refs"];

interface ReceivePackArgs {
    force?: boolean
    receivePack?: string
}

export class RecievePack extends BaseCommand<ReceivePackArgs> {
    constructor(args: any[] = []) {
        super(
            'clone', 
            'lists the contents of a tree object',
            [
                { name: 'hash', type: String, multiple: false, defaultOption: true },
                { name: 'recursive', alias: 'r', type: Boolean },
            ],
            args
        )
    }

    async run(): Promise<void> {
        const remoteAgent = new RemoteAgent(this._repo!);
        remoteAgent.acceptClient("receive-pack", CAPABILITIES);
        await remoteAgent.sendReferences();
        /**
         * accept_client("receive-pack", CAPABILITIES)
         * send_references
         * recv_update_requests
         * recv_objects
         * update_refs
         * exit 0
         */
    }
}