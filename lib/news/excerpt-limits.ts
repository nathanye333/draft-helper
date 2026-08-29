/**
 * Single source of truth for how much article text we surface as an "excerpt".
 *
 * These are shared by the digest email, the feed-chunks API, and the triage
 * board so a story reads the same everywhere. Raising the char budget alone is
 * not enough — the passage count has to go up with it, otherwise ranking still
 * only ever returns two chunks and the budget goes unused.
 */

/** Passages requested per story. */
export const EXCERPT_CHUNKS_PER_ITEM = 4;

/** Hard ceiling the feed-chunks API will accept for passages per story. */
export const MAX_EXCERPT_CHUNKS_PER_ITEM = 8;

/** Joined excerpt length shown in the digest email. */
export const DIGEST_EXCERPT_MAX_CHARS = 900;

/** Joined excerpt length shown per story on the triage board. */
export const FEED_EXCERPT_MAX_CHARS = 900;

/** Stored passages rendered per story on the triage board. */
export const MAX_RENDERED_CHUNKS_PER_ITEM = 4;

/** Separator between non-adjacent passages from the same article. */
export const EXCERPT_JOINER = " … ";
