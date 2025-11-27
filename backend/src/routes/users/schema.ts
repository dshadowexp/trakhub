export const userSchema = {
    list: {
        response: {
            200: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        id: { type: "number" },
                        name: { type: "string" },
                    }
                }
            }
        }
    },
    create: {
        body: {
            type: "object",
            required: ["name"],
            properties: {
                name: { type: "string" }
            }
        }
    }
};
