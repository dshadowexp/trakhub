import { RemoteAgent } from "../remote/agent";
import { TrakRepository } from "../repository";


interface ReceivePackArgs {
    force?: boolean
    receivePack?: string
}

const CAPABILITIES = ["no-thin", "report-status", "delete-refs"];

export async function receivePack(args: ReceivePackArgs) {
    const repo = await TrakRepository.repoFind();
    if (!repo)
        return;

    const remoteAgent = new RemoteAgent(repo);
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