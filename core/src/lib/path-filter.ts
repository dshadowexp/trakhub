import { join } from "node:path";

class Trie {
    constructor(public matched: boolean = false, public children: Record<string, Trie> = {}) {}

    static node() {
        return new Trie();
    }

    static fromPaths(paths: string[]) {
        const root = Trie.node();
        root.matched = paths.length === 0;

        for (const path of paths) {
            let trie = root;

            for (const name of Trie.eachFilename(path)) {
                let child = trie.children[name];
                if (!child) {
                    child = Trie.node();
                    trie.children[name] = child;
                }
                trie = child;
            }

            trie.matched = true;
        }

        return root;
    }

    private static *eachFilename(path: string): Iterable<string> {
        for (const part of path.split("/").filter(Boolean)) {
            yield part;
        }
    }
}

export class PathFilter {
    constructor(private _routes: Trie = new Trie(true), private _path: string = '') {}

    *eachEntry(entries: Map<string, any>) {
        for (const [name, entry] of entries) {
            if (this._routes.matched || this._routes.children[name]) {
                yield [name, entry];
            }
        }
    }

    join(name: string) {
        const nextRoutes = this._routes.matched ?  this._routes : this._routes.children[name];
        return new PathFilter(nextRoutes, join(this._path, name))
    }

    static build(paths: string[]) {
        return new PathFilter(Trie.fromPaths(paths));
    }
}