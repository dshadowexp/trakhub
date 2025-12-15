
interface PushArgs {
    force?: boolean
    receivePack?: string
}

const CAPABILITIES = ["report-status"];

export async function push(args: PushArgs) {
    /**
     * configure
     * start_agent("push", @receiver, @push_url, CAPABILITIES)
     * recv_references
     * send_update_requests
     * send_objects
     * print_summary
     * recv_report_status
     * exit (@errors.empty? ? 0 : 1)
     */
}