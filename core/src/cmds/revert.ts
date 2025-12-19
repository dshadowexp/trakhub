import { BaseCommand } from "./-base"

interface RevertArgs {

}

export class Revert extends BaseCommand<RevertArgs> {
    constructor(args: any[] = []) {
        super(
            'revert', 
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