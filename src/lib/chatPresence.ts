/**
 * Tracks which conversation (if any) is currently open/visible on screen,
 * so a realtime "new_message" notification arriving for that exact
 * conversation can be suppressed from popping a duplicate toast — the
 * open ChatConversation surface is already showing the message live.
 *
 * Deliberately a plain module-level ref rather than React context: the
 * toast host lives at the app shell root, several levels above wherever
 * ChatConversation happens to be mounted (Friends tab, or an in-game
 * overlay panel), and this only needs to be read at the moment a
 * notification event fires — it never needs to trigger a re-render.
 */
export const activeConversation: { current: string | null } = { current: null }

export function setActiveConversation(conversationId: string | null) {
  activeConversation.current = conversationId
}
