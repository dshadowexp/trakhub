import { BaseCommand } from "./-base";

interface ResetArgs {
    hash: string;
    recursive?: boolean;
}

export class Reset extends BaseCommand<ResetArgs> {
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

    }
}