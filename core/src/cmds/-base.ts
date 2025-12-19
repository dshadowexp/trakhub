import commandLineArgs from "command-line-args";
import { TRepository } from "../repo/repository";

export class BaseCommand<T> {
    protected _args: T;
    protected _repo: TRepository | null = null;

    constructor(private _name: string, private _description: string, _options: any, argv: any[] = [], initRepo: boolean = true) {
        this._args = this._initialize(_options, argv);
        if (initRepo)
            this._repo = TRepository.repoFind();
    }

    private _initialize<T>(options: any, argv: any[]): T {
        return commandLineArgs(options, { argv }) as T;
    }
    
    run(): Promise<void> {
        throw new Error("Method not implemented.");
    }
}