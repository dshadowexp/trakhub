export class TrakAuthor {
    constructor(private _name: string, private _email: string, private _timestamp: number = 0) {
        this._timestamp = this._timestamp == 0 ? this._initTimestamp() : this._timestamp;
    }

    get timestamp(): number {
        return this._timestamp;
    }

    private _initTimestamp(): number {
        return Math.floor((new Date()).getTime() / 1000);
    }

    serialize(): string {
        return `${ this._name } <${ this._email }>`;
    }
}
