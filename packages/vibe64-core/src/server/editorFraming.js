// Who may show the editor in a frame: only the editor itself. A host's editors
// and the Previews of its users' code can share a site (vibe64.studio is no
// public suffix, so v64preview-<hash>.<ws>.vibe64.studio is same-site with
// <ws>.vibe64.studio), and a signed-in editor's SameSite=Lax cookie reaches a
// same-site frame, so a Preview could otherwise frame the editor and trick
// clicks. The release's server bundle starts its features without JSKIT's
// security headers (tooling/release/server-build.mjs), so the editor's server
// sends this policy itself, whichever runtime serves it.
//
// Development and test are left open: there an outer editor's Preview frames
// this one (Vibe64 developed in Vibe64), from the Preview's own origin.

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */

const FRAME_ANCESTORS_SELF = "frame-ancestors 'self'";
const X_FRAME_OPTIONS_SAMEORIGIN = "SAMEORIGIN";
const FRAMEABLE_ENVIRONMENTS = Object.freeze(["development", "test"]);
const FRAME_ANCESTORS_DIRECTIVE = /(?:^|;)\s*frame-ancestors(?:\s|;|$)/iu;
const FRAMED_ON_PURPOSE = Symbol("vibe64.framedOnPurpose");

/**
 * Marks a response as one any page may frame, such as a Pages viewing link's
 * frame host and files: it keeps exactly the headers its route gave it.
 * @template {object} Reply
 * @param {Reply} reply
 * @returns {Reply}
 */
function framedOnPurpose(reply) {
  reply[FRAMED_ON_PURPOSE] = true;
  return reply;
}

/**
 * Whether this server's responses refuse other sites' frames: everywhere but
 * development and test, an unset or unknown APP_ENV included.
 * @param {RuntimeEnv} env
 */
function refusesOtherFrames(env) {
  return !FRAMEABLE_ENVIRONMENTS.includes(String(env?.APP_ENV ?? "").trim());
}

/**
 * Whether a response's Content-Security-Policy, one policy or several, names
 * its frame ancestors.
 * @param {string | string[]} policy
 */
function namesFrameAncestors(policy) {
  return [policy].flat().some((text) => FRAME_ANCESTORS_DIRECTIVE.test(String(text)));
}

/**
 * A response's Content-Security-Policy with frame-ancestors 'self' added to its
 * first policy, so the response still sends one header.
 * @param {string | string[]} policy
 */
function withFrameAncestorsSelf(policy) {
  const [first, ...others] = [policy].flat().map((text) => String(text));
  const directives = first.trim().replace(/[\s;]+$/u, "");
  const framed = directives ? `${directives}; ${FRAME_ANCESTORS_SELF}` : FRAME_ANCESTORS_SELF;
  return others.length > 0 ? [framed, ...others] : framed;
}

/**
 * @param {{ getHeader(name: string): unknown, raw: { getHeader(name: string): unknown } }} reply
 * @param {string} name
 */
function replyHeader(reply, name) {
  return reply.getHeader(name) ?? reply.raw.getHeader(name);
}

/**
 * Every response the editor's server sends, its pages, files, API answers and
 * errors alike, carries `Content-Security-Policy: frame-ancestors 'self'` and
 * `X-Frame-Options: SAMEORIGIN` outside development and test. A route's own
 * policy gains the directive; one that already names its frame ancestors
 * keeps them, and its X-Frame-Options, as they are. Register it before any
 * plugin, so every route inherits it.
 * @param {import("fastify").FastifyInstance} fastify
 * @param {{ env: RuntimeEnv }} options
 */
function registerEditorFraming(fastify, { env }) {
  if (!refusesOtherFrames(env)) {
    return;
  }
  fastify.addHook("onSend", async (request, reply, payload) => {
    if (reply[FRAMED_ON_PURPOSE] === true) {
      return payload;
    }
    const policy = replyHeader(reply, "content-security-policy");
    if (policy === undefined) {
      reply.header("content-security-policy", FRAME_ANCESTORS_SELF);
    } else if (namesFrameAncestors(policy)) {
      return payload;
    } else {
      reply.header("content-security-policy", withFrameAncestorsSelf(policy));
    }
    if (replyHeader(reply, "x-frame-options") === undefined) {
      reply.header("x-frame-options", X_FRAME_OPTIONS_SAMEORIGIN);
    }
    return payload;
  });
}

export {
  framedOnPurpose,
  registerEditorFraming
};
