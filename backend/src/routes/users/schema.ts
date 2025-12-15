import { type FastifySchema } from 'fastify';

export const createUserSchema: FastifySchema = {
    body: {
        type: 'object',
        required: ['name', 'email'],
        properties: {
            name: { type: 'string', minLength: 2, maxLength: 100 },
            email: { type: 'string', format: 'email' },
            age: { type: 'integer', minimum: 0, maximum: 150 },
        },
    },
    response: {
        201: {
            type: 'object',
            properties: {
                id: { type: 'integer' },
                name: { type: 'string' },
                email: { type: 'string' },
                age: { type: 'integer' },
                createdAt: { type: 'string' },
            },
        },
    },
};

export const getUsersSchema: FastifySchema = {
    response: {
        200: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: { type: 'integer' },
                    name: { type: 'string' },
                    email: { type: 'string' },
                    age: { type: 'integer' },
                    createdAt: { type: 'string' },
                },
            },
        },
    },
};

export const getUserByIdSchema: FastifySchema = {
    params: {
        type: 'object',
        required: ['id'],
        properties: {
            id: { type: 'integer' },
        },
    },
};

export const updateUserSchema: FastifySchema = {
    params: {
        type: 'object',
        required: ['id'],
        properties: {
            id: { type: 'integer' },
        },
    },
    body: {
        type: 'object',
        properties: {
            name: { type: 'string', minLength: 2, maxLength: 100 },
            email: { type: 'string', format: 'email' },
            age: { type: 'integer', minimum: 0, maximum: 150 },
        },
    },
};