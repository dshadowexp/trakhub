import { type FastifyPluginAsync } from "fastify";


const userRoutes: FastifyPluginAsync = async (app) => {
    // app.get("/", { schema: userSchema.list }, listUsers);
    // app.post("/", { schema: userSchema.create }, createUser);
};

export default userRoutes;
