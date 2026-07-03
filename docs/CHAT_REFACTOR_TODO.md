# Chat Refactor To-do

Status as of 2026-07-03. This tracks the focused `Chat.jsx` decomposition work on the frontend.

## Completed

- Stage 1: Extracted pure entity and payload helpers to `src/utils/chatHelpers.js`.
- Stage 2: Extracted chat search, snippets, preview hydration, and conversation search helpers to `src/utils/chatSearch.js`.
- Stage 3: Extracted `ConversationHeader.jsx` and `ArchivedTeamBanner.jsx`.
- Stage 4a: Extracted typing indicator state, typing timeout cleanup, typing user resolution, and active typing names to `src/hooks/useChatTyping.js`.
- Stage 4b: Extracted Socket.IO event wiring for messages, read status, conversation updates, team membership changes, deleted conversations, message edits/deletes, and notification-triggered team refreshes to `src/hooks/useChatSocketEvents.js`.
- Stage 4c: Extracted chat search query state, message search indexing, no-result toast handling, filtered conversation derivation, and search-panel visibility to `src/hooks/useChatSearchState.js`.
- Stage 4d: Extracted active conversation loading, team/direct conversation hydration, socket join/leave, read marking, highlight handling, and earlier-message pagination to `src/hooks/useActiveChatConversation.js`; tightened 403/404 team access cleanup, empty direct-chat filtering, and user-scoped conversation cache keys.
- Stage 5a: Extracted team-chat access + membership helpers (`fetchTeamDetails`, `revokeTeamChatAccess`, `refreshActiveTeamMembership`, `hydrateTeamConversationDetails`) and the 10s membership-polling effect to `src/hooks/useChatTeamAccess.js`. Verbatim move; these helpers were already consumed by `useActiveChatConversation` and `useChatSocketEvents`, so centralizing them untangles the prior `Chat.jsx` -> hooks prop wiring. `fetchTeamDetails` stays internal to the hook (only used by the other helpers).
- Stage 5: Extracted message + conversation action handlers to `src/hooks/useChatMessageActions.js`: send (text/image/file), edit, delete message, reply state wiring (`handleReplyToMessage`/`handleClearReply`), and the confirmable chat actions that share the `pendingChatAction` modal (`handleLeaveTeam`/`handleDeleteConversation`/`handleDeleteMessage` + `confirmPendingChatAction`/`closePendingChatAction` + `handleTeamDetailsLeave`). `execute*` helpers stay internal to the hook. Following the established chat-hook pattern, `Chat.jsx` remains the state owner (keeps `replyingTo`/`pendingChatAction`/`pendingChatActionLoading` state + the `pendingChatActionConfig`/Modal JSX) and passes state + setters in; the hook returns the handlers. Keeping `replyingTo` in `Chat.jsx` avoids a cycle (`useChatTeamAccess` needs `setReplyingTo`, message actions need `refreshActiveTeamMembership`). Removed now-unused imports `socketService`, `teamService`, `uploadToImageKit`. `Chat.jsx` 1350 -> 962 lines.

## Current Branch

- `refactor/chat-jsx-decomposition-stage-5-message-actions` (off Stage 5a)
- Latest completed work: extracted message/conversation action handlers to `useChatMessageActions`; `Chat.jsx` calls it after `useChatTeamAccess`/`useChatTyping` (consumes `refreshActiveTeamMembership`, `handleTyping`, `clearTypingUsers`) and binds the returned handlers in the render.

## Verification

- `npm run lint` passes with existing warnings.
- `npm run build` passes with the existing Vite chunk-size warning.
- Manual smoke passed:
  - DM typing indicator appears and clears.
  - DM send keeps the optimistic message without duplicate rendering.
  - Team chat typing indicator shows the expected display name.
  - Switching conversations does not leak old typing indicators.
  - New DM and incoming message update the active chat and conversation list.
  - Read status updates still render.
  - Message edit/delete socket updates still render.
  - Team chat membership/notification refresh paths still behave as expected.
  - Chat search filters by conversation metadata and message snippets.
  - Search-result selection still reveals and highlights the matching message.
  - No-result feedback still appears and can be dismissed.
- Active direct and team conversations still load messages and details.
- Socket join/read marking still happens after conversation load.
- Earlier-message pagination preserves scroll position.
- Notification/search highlights still reveal the target message.
- Revoked/deleted team conversations are removed from the list without repeated 403/404 fetch loops.
- Empty direct chats remain transient while actively opened but are not kept in the persistent conversation list.
- Switching accounts in the same browser uses a user-scoped conversation cache instead of reusing another user's chat list.

## Next Recommended Work

- Review remaining `Chat.jsx` responsibilities and decide whether Stage 5 should focus on send/edit/delete actions or team access helpers.
- Consider a short pause before further extraction: Stage 4a-4d moved the highest-value state/effect clusters out of `Chat.jsx`.

## Guardrails

- Keep one focused branch and one focused commit per extraction stage.
- Prefer verbatim moves where possible; behavior changes should be separate commits.
- After each stage, run `npm run lint`, `npm run build`, and a chat smoke test.
- Watch JSX imports manually: ESLint does not reliably catch all missing or stale uppercase component/icon imports in this repo.
