import { BaseCommand } from "./-base";

interface CherryPickArgs {

}

export class CherryPick extends BaseCommand<CherryPickArgs> {
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

    }
}
