import { type FastifyPluginAsync } from 'fastify';
import type { CreateUserInput, UpdateUserInput } from "../../types/user";
import { userService } from './service';
import {
  createUserSchema,
  getUsersSchema,
  getUserByIdSchema,
  updateUserSchema,
} from './schema';

const usersRoute: FastifyPluginAsync = async (fastify) => {
    // Create user
    fastify.post<{ Body: CreateUserInput }>(
        '/',
        { schema: createUserSchema },
        async (request, reply) => {
            const user = userService.create(request.body);
            return reply.code(201).send(user);
        }
    );

    // Get all users
    fastify.get('/', { schema: getUsersSchema }, async () => {
        return userService.findAll();
    });

    // Get user by ID
    fastify.get<{ Params: { id: string } }>(
        '/:id',
        { schema: getUserByIdSchema },
        async (request, reply) => {
            const user = userService.findById(parseInt(request.params.id));

            if (!user) {
                return reply.notFound('User not found');
            }

            return user;
        }
    );

    // Update user
    fastify.put<{ Params: { id: string }; Body: UpdateUserInput }>(
        '/:id',
        { schema: updateUserSchema },
        async (request, reply) => {
            const id = parseInt(request.params.id);
            const user = userService.update(id, request.body);

            if (!user) {
                return reply.notFound('User not found');
            }

            return user;
        }
    );

    // Delete user
    fastify.delete<{ Params: { id: string } }>(
        '/:id',
        { schema: getUserByIdSchema },
        async (request, reply) => {
            const deleted = userService.delete(parseInt(request.params.id));

            if (!deleted) {
                return reply.notFound('User not found');
            }

            return reply.code(204).send();
        }
    );
};

export default usersRoute;
