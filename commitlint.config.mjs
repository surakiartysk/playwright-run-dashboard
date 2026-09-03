/**
 * Conventional Commits, with the scopes this repo actually uses.
 *
 * `scope-enum` is deliberately closed: an open list drifts into a dozen
 * near-synonyms within a month. Adding a scope should be a decision, so it is
 * an edit here.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        // packages
        'api',
        'ui',
        // api surfaces — mirrors src/routes/
        'auth',
        'runs',
        'webhook',
        'reports',
        'demo',
        // cross-cutting
        'policy',
        'crypto',
        'db',
        'core',
        'ci',
        'deps',
      ],
    ],
    // The body carries the reasoning in this repo, so it gets room.
    'body-max-line-length': [2, 'always', 100],
  },
}
