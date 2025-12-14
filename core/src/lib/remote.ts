

const fetchRefs = async (trakUrl: string) => {
    try {
        const response = await fetch(
            `${trakUrl}/info/refs?service=git-upload-pack`,
            { method: "GET" }
        );

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const text = await response.text();
        const [additions, ...refs] = text.split("\n").slice(1, -1);
        const capabilities = additions.split("\0")[1].split(" ");
        const symref = capabilities.find((cap) => cap.startsWith("symref=HEAD:"));

        return {
            capabilities,
            HEAD: symref?.split("symref=HEAD:")[1] || "",
            data: refs.map((ref) => {
                const [hash, name] = ref.split(" ");

                // the first 4 bytes represent the size of the entire string
                return { hash: hash.slice(4), ref: name };
            }),
        };
    } catch (error) {
        console.error(error);
    }

    return null;
};