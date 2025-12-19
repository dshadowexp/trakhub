import { BaseCommand } from "./-base";

interface PullArgs {
    hash: string;
    recursive?: boolean;
}

export class Pull extends BaseCommand<PullArgs> {
    constructor(args: any[] = []) {
        super(
            'pull', 
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