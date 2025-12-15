import { parse } from "./src/parser";

(async () => {
    await parse(process.argv.slice(2));
})();
