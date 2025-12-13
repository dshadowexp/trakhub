import { type FastifyPluginAsync } from "fastify";
import { userSchema } from "./schema";
import { listUsers, createUser } from "./controller";

const userRoutes: FastifyPluginAsync = async (app) => {
    app.get("/", { schema: userSchema.list }, listUsers);
    app.post("/", { schema: userSchema.create }, createUser);
};

export default userRoutes;
