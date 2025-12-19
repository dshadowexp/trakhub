import { BaseCommand } from "./-base";

interface PushArgs {
    force?: boolean
    receivePack?: string
}

const CAPABILITIES = ["report-status"];

export class Reset extends BaseCommand<PushArgs> {
    constructor(args: any[] = []) {
        super(
            'reset', 
            'lists the contents of a tree object',
            [
                { name: 'hash', type: String, multiple: false, defaultOption: true },
                { name: 'recursive', alias: 'r', type: Boolean },
            ],
            args
        )
    }

    async run(): Promise<void> {
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
}