/**
 * Where the admin login/logout endpoints are mounted.
 *
 * Kept in a leaf module so that `UI/Express.ts` can mount the path without importing the auth
 * controller, which would pull the whole tRPC router graph into the express module.
 */
export const ADMIN_AUTH_BASE_PATH = '/admin-auth'
