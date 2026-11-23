// Only central, data-free refusal messages may reach workflow logs.
export class ChannelError extends Error {}
export function insist(condition, message) { if (!condition) throw new ChannelError(message); }
export function channelFailure(error) {
  return error instanceof ChannelError ? error.message : "Invalid or unavailable release evidence; see docs/release-channels.md";
}
