/**
 * The one route besides the runs: `/admin` (decision 52).
 *
 * A path rather than a tab in the page, so the admin page can be linked and a
 * reload lands back on it. Pages serves the app for any path it has no file
 * for, so nothing on the server has to know about it.
 */
export const ADMIN_PATH = '/admin'

export const onAdminPage = (pathname: string): boolean =>
  pathname === ADMIN_PATH || pathname === `${ADMIN_PATH}/`

export const pathFor = (admin: boolean): string => (admin ? ADMIN_PATH : '/')
