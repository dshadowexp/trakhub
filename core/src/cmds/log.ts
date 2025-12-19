import { Terminal } from "../lib/standard";
import { formatGitDate } from "../util";
import { BaseCommand } from "./-base";

interface LogArgs {
    oneline?: boolean
}

export class Log extends BaseCommand<LogArgs> {
    constructor(args: any[] = []) {
        super(
            'log', 
            'lists the contents of a tree object',
            [
                { name: 'oneline', alias: 'o', type: Boolean },
            ],
            args
        )
    }

    async run(): Promise<void> {
        let commitHash = await this._repo!.refs.readHead();
        if (!commitHash) {
            process.stdout.write("No commits yet!\n");
            return;
        }

        const history = this._historyGenerator( commitHash);
        let current = await history.next();
        
        while (!current.done) {
            const next = await history.next();
            Terminal.println(`${ current.value }${ next.done ? '' : this._args.oneline ? '' : '\n'}`);
            current = next;
        }
    }

    private async* _historyGenerator(commitHash: string): AsyncGenerator<string> {
        const queue: string[] = [];
        queue.push(commitHash);
        let count = 0;
    
        while (queue.length > 0 && count < 10) {
            const currentCommit = queue.shift()!;
            const commit = await this._repo!.objects.loadCommit(currentCommit);

            if (this._args.oneline) {
                yield `${ this._repo!.objects.shortHash(currentCommit) } ${ commit.titleLine }`;
            } else {
                yield [
                    `commit ${ currentCommit }\n`,
                    `Author: ${ commit.author.serialize() }\n`,
                    `Date:   ${ formatGitDate(commit.author.timestamp) }\n`,
                    `\n\t${ commit.message }`
                ].join('');
            }
            
            queue.push(...commit.parentHashes);
            count += 1
        }
    }
}
