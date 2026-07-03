import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  LogOut,
  ChevronRight,
  ChevronLeft,
  User,
  Trash2,
  Search,
  X,
} from "lucide-react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { fetchTeamById } from "../hooks/useTeamQueries";
import {
  useConversations,
  conversationsQueryKey,
  getConversationsQueryKey,
} from "../hooks/useChatQueries";
import PageContainer from "../components/layout/PageContainer";
import ConversationList from "../components/chat/ConversationList";
import ConversationHeader from "../components/chat/ConversationHeader";
import ArchivedTeamBanner from "../components/chat/ArchivedTeamBanner";
import MessageDisplay from "../components/chat/MessageDisplay";
import MessageInput from "../components/chat/MessageInput";
import { useAuth } from "../contexts/AuthContext";
import { messageService } from "../services/messageService";
import socketService from "../services/socketService";
import useChatTyping from "../hooks/useChatTyping";
import useChatSocketEvents from "../hooks/useChatSocketEvents";
import useChatSearchState from "../hooks/useChatSearchState";
import useActiveChatConversation from "../hooks/useActiveChatConversation";
import { userService } from "../services/userService";
import { isQuietError } from "../services/api";
import { teamService } from "../services/teamService";
import ScreenAlert from "../components/common/ScreenAlert";
import Button from "../components/common/Button";
import Modal from "../components/common/Modal";
import Tooltip from "../components/common/Tooltip";
import { CountBadge } from "../components/common/NotificationBadge";
import { uploadToImageKit } from "../config/imagekit";
import UserAvatar from "../components/users/UserAvatar";
import TeamAvatar from "../components/teams/TeamAvatar";
import TeamDetailsModal from "../components/teams/TeamDetailsModal";
import UserDetailsModal from "../components/users/UserDetailsModal";
import { DEMO_PROFILE_TOOLTIP, DEMO_TEAM_TOOLTIP } from "../utils/userHelpers";
import {
  normalizeTimestampToDate,
  formatArchiveTimeRemaining,
  msUntilNextArchiveChange,
} from "../utils/dateHelpers";
import {
  getConversationPartnerId,
  isActiveTeamMemberRow,
  isUserTeamMember,
  mergeTeamDetailsIntoConversationData,
  isArchivedTeamData,
  getConversationUpdatedAt,
} from "../utils/chatHelpers";
import {
  dedupeConversations,
  hydrateConversationPreviews,
} from "../utils/chatSearch";

// Stable empty fallback so the conversations query's default never changes
// identity between renders (avoids needless re-renders / effect re-runs).
const EMPTY_CONVERSATIONS = [];
const EMPTY_DIRECT_CONVERSATION_PREVIEW = "Start your conversation...";

const isTransientEmptyDirectConversation = (conversation) =>
  conversation?.type === "direct" &&
  conversation?.isVirtual &&
  (conversation.lastMessage ?? conversation.last_message) ===
    EMPTY_DIRECT_CONVERSATION_PREVIEW;

const Chat = () => {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, isAuthenticated, blockedRelationshipIds } = useAuth();
  const isBlockedId = useCallback(
    (id) =>
      id != null && blockedRelationshipIds?.has?.(String(id)),
    [blockedRelationshipIds],
  );
  const activeConversationsQueryKey = useMemo(
    () => getConversationsQueryKey(user?.id),
    [user?.id],
  );
  // Conversation list is backed by the React Query cache. The query fetches +
  // dedupes + hydrates previews once per user (switching chats no longer
  // refetches the list); socket/local updates mutate that user's cache via the
  // setConversations wrapper below, keeping their (prev) => next shape.
  const fetchConversations = useCallback(async () => {
    const response = await messageService.getConversations();
    return hydrateConversationPreviews(dedupeConversations(response.data || []));
  }, []);
  const {
    data: conversations = EMPTY_CONVERSATIONS,
    isLoading: loading,
    isError: conversationsLoadError,
  } = useConversations(fetchConversations, isAuthenticated, user?.id);
  const setConversations = useCallback(
    (next) =>
      queryClient.setQueryData(
        activeConversationsQueryKey,
        (prev = EMPTY_CONVERSATIONS) =>
          typeof next === "function" ? next(prev) : next,
      ),
    [activeConversationsQueryKey, queryClient],
  );
  const [activeConversation, setActiveConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [replyingTo, setReplyingTo] = useState(null);
  const [error, setError] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [highlightMessageIds, setHighlightMessageIds] = useState([]);
  const [isTeamArchived, setIsTeamArchived] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [teamMembersRefreshSignal, setTeamMembersRefreshSignal] =
    useState(null);
  const [showChatView, setShowChatView] = useState(true); // Toggle between list and chat on mobile
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [selectedTeamData, setSelectedTeamData] = useState(null);
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [pendingChatAction, setPendingChatAction] = useState(null);
  const [pendingChatActionLoading, setPendingChatActionLoading] =
    useState(false);
  const [isActiveConversationVisible, setIsActiveConversationVisible] =
    useState(true);
  const messagesContainerRef = useRef(null);
  const pendingScrollAdjustmentRef = useRef(null);
  const conversationsRef = useRef([]);
  const activeConversationRef = useRef(null);
  const messagesRef = useRef([]);
  const pendingChatSearchTargetRef = useRef(null);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // Conversation type (used for read-only rendering)
  const conversationType =
    activeConversation?.type ||
    new URLSearchParams(window.location.search).get("type") ||
    "direct";
  const handleChatSearchQueryChange = useCallback(() => {
    setHighlightMessageIds([]);
  }, []);
  const {
    activeTypingUsers,
    clearTypingUsers,
    handleTyping,
    handleTypingUpdate,
  } = useChatTyping({
    conversationId,
    currentUser: user,
    activeConversation,
  });
  const {
    chatSearchEmptyState,
    chatSearchQuery,
    filteredConversations,
    hideChatDuringSearch,
    isChatSearchActive,
    isNoSearchResults,
    normalizedChatSearchQuery,
    revealSearchChat,
    searchingChatMessages,
    searchNoResultsToastQuery,
    setChatSearchQuery,
    setSearchNoResultsToastQuery,
    totalSearchMatches,
  } = useChatSearchState({
    conversationId,
    conversationType,
    conversations,
    isAuthenticated,
    messages,
    onSearchQueryChange: handleChatSearchQueryChange,
  });

  // ---- Message de-duplication (focus: ownership/system duplicates) ----
  const toMinuteBucket = (isoOrDate) => {
    try {
      const d = isoOrDate ? normalizeTimestampToDate(isoOrDate) : null;
      if (!d || Number.isNaN(d.getTime())) return "";
      return d.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
    } catch {
      return "";
    }
  };

  const buildMessageDedupeKey = (msg) => {
    const content = (msg?.content || "").trim();
    const minute = toMinuteBucket(msg?.createdAt);
    const senderId = msg?.senderId ?? "";

    // OWNERSHIP_TEAM (legacy emoji optional)
    let m = content.match(/^(?:👑\s*)?OWNERSHIP_TEAM:\s*(.+?)\s*\|\s*(.+)\s*$/);
    if (m) return `ownership_team|${m[1].trim()}|${m[2].trim()}|${minute}`;

    // OWNERSHIP_TRANSFERRED (legacy emoji optional)
    m = content.match(
      /^(?:👑\s*)?OWNERSHIP_TRANSFERRED:\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+)\s*$/,
    );
    if (m)
      return `ownership_transferred|${m[1].trim()}|${m[2].trim()}|${m[3].trim()}|${minute}`;

    // Plain team chat sentence variant
    m = content.match(
      /^(.+?)\s+transferred\s+(?:team\s+)?ownership\s+to\s+(.+?)\.?$/i,
    );
    if (m)
      return `ownership_team_plain|${m[1].trim()}|${m[2].trim()}|${minute}`;

    // Plain DM sentence variant
    m = content.match(
      /^(.+?)\s+transferred\s+ownership\s+of\s+"(.+?)"\s+to\s+you\.\s*Congratulations!?\.?$/i,
    );
    if (m) return `ownership_dm_plain|${m[1].trim()}|${m[2].trim()}|${minute}`;

    // Fallback: exact duplicates per minute
    return `generic|${senderId}|${content}|${minute}`;
  };

  const dedupeMessages = (list) => {
    const seen = new Set();
    const out = [];
    for (const msg of list || []) {
      const key = buildMessageDedupeKey(msg);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(msg);
    }
    return out;
  };

  const conversationPartner =
    conversationType === "direct"
      ? activeConversation?.partner || activeConversation?.partnerUser || null
      : null;

  const teamData =
    conversationType === "team" ? activeConversation?.team || null : null;
  const isActiveTeamArchived = isTeamArchived || isArchivedTeamData(teamData);

  // Time left before an archived team + its chat are permanently deleted
  // (whole days, then remaining hours on the final day). Refreshed on a
  // self-scheduling timer — once per day, then hourly on the final day —
  // instead of recomputing on every render.
  const activeTeamArchivedAt = teamData?.archivedAt ?? teamData?.archived_at;
  const [activeTeamArchiveTimeRemaining, setActiveTeamArchiveTimeRemaining] =
    useState(null);
  useEffect(() => {
    if (!isActiveTeamArchived || !activeTeamArchivedAt) {
      setActiveTeamArchiveTimeRemaining(null);
      return undefined;
    }
    let timeoutId;
    const update = () => {
      setActiveTeamArchiveTimeRemaining(
        formatArchiveTimeRemaining(activeTeamArchivedAt),
      );
      const delay = msUntilNextArchiveChange(activeTeamArchivedAt);
      if (delay != null) {
        timeoutId = setTimeout(update, delay);
      }
    };
    update();
    return () => clearTimeout(timeoutId);
  }, [isActiveTeamArchived, activeTeamArchivedAt]);

  const teamMembers = useMemo(() => {
    const members =
      conversationType === "team" ? activeConversation?.team?.members || [] : [];
    // Hide blocked users from the roster/mention list (both directions).
    return members.filter((member) => {
      const memberId =
        member?.userId ?? member?.user_id ?? member?.id ?? member?.user?.id;
      return !isBlockedId(memberId);
    });
  }, [conversationType, activeConversation?.team?.members, isBlockedId]);
  // Hide messages from blocked users from the rendered stream (both directions).
  // The backend already filters fetches and realtime delivery; this keeps an
  // open session consistent the instant a block is added/removed.
  const visibleMessages = useMemo(
    () =>
      messages.filter(
        (message) => !isBlockedId(message?.senderId ?? message?.sender_id),
      ),
    [messages, isBlockedId],
  );
  const isCurrentUserActiveTeamMember =
    conversationType !== "team" || isUserTeamMember(teamMembers, user?.id);
  const canSendInActiveConversation =
    Boolean(activeConversation) && isCurrentUserActiveTeamMember;

  const fetchTeamDetails = useCallback(
    (teamId, { force = false } = {}) => {
      if (!teamId) return Promise.resolve(null);
      // React Query handles caching and in-flight request dedup that this
      // component used to track by hand (see fetchTeamById).
      return fetchTeamById(queryClient, teamId, { force });
    },
    [queryClient],
  );

  const revokeTeamChatAccess = useCallback(
    (teamId, message = "You no longer have access to this team chat.") => {
      if (!teamId) return;

      socketService.leaveConversation(teamId, "team");
      setError(message);
      setConversations((prev) =>
        prev.filter(
          (conversation) =>
            !(
              conversation.type === "team" &&
              String(conversation.id) === String(teamId)
            ),
        ),
      );

      const activeTeamId =
        activeConversationRef.current?.team?.id ?? activeConversationRef.current?.id;

      if (
        String(activeTeamId) === String(teamId) ||
        (String(conversationId) === String(teamId) &&
          (searchParams.get("type") || "direct") === "team")
      ) {
        setActiveConversation(null);
        setMessages([]);
        clearTypingUsers();
        setReplyingTo(null);
        setHighlightMessageIds([]);
        setHasMoreMessages(false);
        setShowChatView(false);
        navigate("/chat", { replace: true });
      }
    },
    [
      clearTypingUsers,
      conversationId,
      navigate,
      searchParams,
      setConversations,
    ],
  );

  const refreshActiveTeamMembership = useCallback(
    async (teamId) => {
      if (!teamId || !user?.id) return true;

      let teamPayload = null;

      try {
        const conversationResponse = await messageService.getConversationById(
          teamId,
          "team",
        );
        teamPayload = conversationResponse?.data?.team || null;
      } catch (conversationError) {
        if (
          conversationError.response?.status === 404 ||
          conversationError.response?.status === 403
        ) {
          revokeTeamChatAccess(teamId);
          return false;
        }

        throw conversationError;
      }

      if (!Array.isArray(teamPayload?.members)) {
        try {
          teamPayload = await fetchTeamDetails(teamId, { force: true });
        } catch (teamError) {
          if (teamError.response?.status === 404 && isArchivedTeamData(teamPayload)) {
            return true;
          }

          throw teamError;
        }
      }

      if (!isUserTeamMember(teamPayload.members, user.id)) {
        revokeTeamChatAccess(teamId);
        return false;
      }

      setActiveConversation((prev) => {
        if (
          !prev ||
          prev.type !== "team" ||
          String(prev.team?.id ?? prev.id) !== String(teamId)
        ) {
          return prev;
        }

        return {
          ...prev,
          team: mergeTeamDetailsIntoConversationData(prev, teamPayload).team,
        };
      });

      return true;
    },
    [fetchTeamDetails, revokeTeamChatAccess, user?.id],
  );

  const hydrateTeamConversationDetails = useCallback(
    async (conversationDetails, teamId) => {
      if (!conversationDetails?.data || !teamId) return false;

      if (isArchivedTeamData(conversationDetails.data.team)) {
        setIsTeamArchived(true);

        if (Array.isArray(conversationDetails.data.team?.members)) {
          if (!isUserTeamMember(conversationDetails.data.team.members, user?.id)) {
            revokeTeamChatAccess(teamId);
            setLoadingMessages(false);
            return true;
          }
        }

        return false;
      }

      try {
        const teamPayload = await fetchTeamDetails(teamId);

        setIsTeamArchived(isArchivedTeamData(teamPayload));

        if (Array.isArray(teamPayload?.members)) {
          if (!isUserTeamMember(teamPayload.members, user?.id)) {
            revokeTeamChatAccess(teamId);
            setLoadingMessages(false);
            return true;
          }

          conversationDetails.data = mergeTeamDetailsIntoConversationData(
            conversationDetails.data,
            teamPayload,
          );
        }
      } catch (teamError) {
        console.error("Error fetching team member details:", teamError);
      }

      return false;
    },
    [fetchTeamDetails, revokeTeamChatAccess, user?.id],
  );

  const { loadEarlierMessages } = useActiveChatConversation({
    conversationId,
    conversationsRef,
    dedupeMessages,
    hasMoreMessages,
    hydrateTeamConversationDetails,
    isAuthenticated,
    loadingMore,
    messages,
    messagesContainerRef,
    navigate,
    pendingChatSearchTargetRef,
    pendingScrollAdjustmentRef,
    revokeTeamChatAccess,
    searchParams,
    setActiveConversation,
    setConversations,
    setError,
    setHasMoreMessages,
    setHighlightMessageIds,
    setIsTeamArchived,
    setLoadingMessages,
    setLoadingMore,
    setMessages,
    setSearchParams,
    user,
  });

  const mentionParticipants = useMemo(() => {
    if (conversationType === "direct") {
      return conversationPartner ? [conversationPartner] : [];
    }
    const members = teamMembers
      .filter(isActiveTeamMemberRow)
      .map((m) => m.user || m)
      .filter((m) => {
        const id = m.userId ?? m.user_id ?? m.id;
        return id && String(id) !== String(user?.id);
      })
      .map((m) => ({
        id: m.userId ?? m.user_id ?? m.id,
        firstName: m.firstName || m.first_name || "",
        lastName: m.lastName || m.last_name || "",
        avatarUrl: m.avatarUrl || m.avatar_url || null,
      }));
    return [{ id: "all", firstName: "all", lastName: "" }, ...members];
  }, [conversationType, conversationPartner, teamMembers, user?.id]);

  const conversationUpdatedAt =
    getConversationUpdatedAt(activeConversation) ||
    getConversationUpdatedAt(messages?.[messages.length - 1] || messages?.[0] || null);
  const showCompactConversationHeader =
    Boolean(conversationId) &&
    !isActiveConversationVisible;
  const showEmptyConversationState =
    !loading && conversations.length === 0 && !conversationId;

  useEffect(() => {
    setReplyingTo(null);
  }, [conversationId, conversationType]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    setConversations((prev) => {
      const next = prev.filter(
        (conversation) =>
          !isTransientEmptyDirectConversation(conversation) ||
          String(conversation.id) === String(conversationId),
      );

      return next.length === prev.length ? prev : next;
    });
  }, [conversationId, setConversations]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    activeConversationRef.current = activeConversation;
  }, [activeConversation]);

  useEffect(() => {
    if (
      conversationType !== "team" ||
      !activeConversation?.team?.id ||
      !user?.id
    ) {
      return undefined;
    }

    const teamId = activeConversation.team.id;
    let cancelled = false;

    const checkMembership = async () => {
      try {
        if (!cancelled) {
          await refreshActiveTeamMembership(teamId);
        }
      } catch (err) {
        console.error("Error checking active team chat access:", err);
      }
    };

    checkMembership();
    const intervalId = window.setInterval(checkMembership, 10000);

    const handleFocus = () => {
      checkMembership();
    };

    window.addEventListener("focus", handleFocus);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
    };
  }, [
    activeConversation?.team?.id,
    conversationType,
    refreshActiveTeamMembership,
    user?.id,
  ]);

  useEffect(() => {
    setIsActiveConversationVisible(true);
  }, [conversationId]);

  const handleActiveConversationVisibilityChange = useCallback((isVisible) => {
    setIsActiveConversationVisible((current) =>
      current === isVisible ? current : isVisible,
    );
  }, []);

  // Re-fetch the conversation list by invalidating its query (the queryFn
  // re-runs the dedupe + preview hydration). React Query dedupes concurrent
  // invalidations, so the burst of socket handlers that used to each trigger a
  // fresh getConversations now collapse into a single refetch.
  const refreshConversationList = useCallback(
    () => queryClient.invalidateQueries({ queryKey: conversationsQueryKey }),
    [queryClient],
  );

  // Apply live block/unblock changes to the chat view: drop blocked DMs (and
  // restore unblocked ones) from the list, and close the active DM if its
  // partner is now blocked. Team chats stay open — the blocker is hidden via
  // the visibleMessages / teamMembers filters. The first run is skipped because
  // the initial conversation fetch below already loads the correct state.
  const prevBlockedIdsRef = useRef(blockedRelationshipIds);
  useEffect(() => {
    if (!isAuthenticated) return;
    // Only react to an ACTUAL block/unblock change — compare the value, not a
    // first-run boolean. A "skip first run" boolean ref is defeated by React
    // StrictMode's mount double-invoke: the ref persists, so the 2nd invoke
    // passes the guard and refetches the list on every Chat mount. Comparing
    // the blockedRelationshipIds Set by reference (it only changes when
    // AuthContext updates it) is StrictMode-safe and mount-safe.
    if (prevBlockedIdsRef.current === blockedRelationshipIds) return;
    prevBlockedIdsRef.current = blockedRelationshipIds;

    refreshConversationList();

    const currentUrlType =
      new URLSearchParams(window.location.search).get("type") ||
      activeConversationRef.current?.type ||
      "direct";
    if (currentUrlType !== "direct") return;

    const activePartnerId = getConversationPartnerId(
      activeConversationRef.current,
    );
    if (isBlockedId(activePartnerId)) {
      setError("This conversation is no longer available.");
      setActiveConversation(null);
      setMessages([]);
      clearTypingUsers();
      setHighlightMessageIds([]);
      setHasMoreMessages(false);
      navigate("/chat", { replace: true });
    }
    // `navigate` is intentionally NOT a dependency: useNavigate() returns a new
    // function identity on every navigation, so including it made this effect
    // re-run — and refetch the whole conversation list — on every chat switch.
    // This effect must only react to block/unblock state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    blockedRelationshipIds,
    clearTypingUsers,
    isAuthenticated,
    isBlockedId,
    refreshConversationList,
  ]);

  // Surface a load failure from the conversations query (matches the old
  // fetch-effect error message).
  useEffect(() => {
    if (conversationsLoadError) {
      setError("Failed to load conversations. Please try again.");
    }
  }, [conversationsLoadError]);

  // Once the conversation list has loaded, either auto-select the first chat
  // (landed on /chat with none chosen) or seed a virtual DM entry when the URL
  // points at a partner not yet in the list (new/never-messaged conversation).
  // Team virtuals are created in the messages effect, so this only handles
  // direct chats. Guarded so each missing id is attempted at most once.
  const seededVirtualConvRef = useRef(null);
  useEffect(() => {
    if (!isAuthenticated || loading) return;

    if (!conversationId) {
      const persistentConversations = conversations.filter(
        (conversation) => !isTransientEmptyDirectConversation(conversation),
      );

      if (persistentConversations.length > 0) {
        const firstConversation = persistentConversations[0];
        const firstConversationType = firstConversation.type || "direct";
        navigate(`/chat/${firstConversation.id}?type=${firstConversationType}`);
      }
      return;
    }

    const conversationExists = conversations.some(
      (conv) => String(conv.id) === String(conversationId),
    );
    if (conversationExists) return;
    if (seededVirtualConvRef.current === String(conversationId)) return;

    const type =
      new URLSearchParams(window.location.search).get("type") || "direct";
    if (type !== "direct") return;

    seededVirtualConvRef.current = String(conversationId);

    (async () => {
      try {
        // A 404 (no such user — stale link or deleted account) is expected and
        // handled gracefully, not console noise.
        const userResponse = await userService.getUserById(conversationId, {
          quietErrorStatuses: [404],
        });
        const userData = userResponse.data;

        const virtualConversation = {
          id: parseInt(conversationId),
          type: "direct",
          partner: {
            id: userData.id,
            username: userData.username,
            firstName: userData.firstName || userData.first_name,
            lastName: userData.lastName || userData.last_name,
            avatarUrl: userData.avatarUrl || userData.avatar_url,
            isSynthetic:
              userData.isSynthetic ?? userData.is_synthetic ?? undefined,
            is_synthetic:
              userData.is_synthetic ?? userData.isSynthetic ?? undefined,
          },
          lastMessage: EMPTY_DIRECT_CONVERSATION_PREVIEW,
          updatedAt: new Date().toISOString(),
          isVirtual: true,
          unreadCount: 0,
        };

        setConversations((prev) =>
          dedupeConversations([virtualConversation, ...prev]),
        );
      } catch (error) {
        if (!isQuietError(error)) {
          console.error("Error creating virtual conversation:", error);
        }
      }
    })();
  }, [
    isAuthenticated,
    loading,
    conversationId,
    conversations,
    navigate,
    setConversations,
  ]);

  useChatSocketEvents({
    activeConversationRef,
    clearTypingUsers,
    conversationId,
    conversationType,
    conversationsRef,
    dedupeMessages,
    handleTypingUpdate,
    isAuthenticated,
    navigate,
    refreshActiveTeamMembership,
    refreshConversationList,
    revokeTeamChatAccess,
    setActiveConversation,
    setConversations,
    setError,
    setHasMoreMessages,
    setHighlightMessageIds,
    setMessages,
    setOnlineUsers,
    setTeamMembersRefreshSignal,
    user,
  });

  const handleHeaderTeamClick = (e) => {
    e.stopPropagation();
    if (teamData?.id) {
      setSelectedTeamId(teamData.id);
      setSelectedTeamData(teamData);
      setIsTeamModalOpen(true);
    }
  };

  const handleHeaderUserClick = (e) => {
    e.stopPropagation();
    if (conversationPartner?.id) {
      setSelectedUserId(conversationPartner.id);
      setIsUserModalOpen(true);
    }
  };

  const closePendingChatAction = () => {
    if (pendingChatActionLoading) return;
    setPendingChatAction(null);
  };

  // Handle leaving a deleted team (removes from conversation list)
  const handleLeaveTeam = async () => {
    if (!activeConversation?.team?.id) {
      return;
    }

    const teamId = activeConversation.team.id;
    const teamName = activeConversation.team.name || "this team";

    setPendingChatAction({ type: "leave-team", teamId, teamName });
  };

  const executeLeaveTeam = async ({ teamId }) => {
    try {
      // Call the existing leave team API
      await teamService.removeTeamMember(teamId, user.id);

      // Remove from local conversation list
      setConversations((prev) => prev.filter((c) => c.id !== teamId));

      // Navigate away
      navigate("/chat");

      setActiveConversation(null);
      setMessages([]);
      setShowChatView(false);
      return true;
    } catch (error) {
      console.error("Error leaving team:", error);
      setError("Failed to leave team. Please try again.");
      return false;
    }
  };

  const handleTeamDetailsLeave = (teamId) => {
    if (!teamId) return;

    setConversations((prev) =>
      prev.filter(
        (conversation) =>
          !(conversation.type === "team" && String(conversation.id) === String(teamId)),
      ),
    );

    if (String(conversationId) === String(teamId)) {
      setActiveConversation(null);
      setMessages([]);
      clearTypingUsers();
      setReplyingTo(null);
      setShowChatView(false);
      setIsTeamModalOpen(false);
      setSelectedTeamId(null);
      setSelectedTeamData(null);
      navigate("/chat", { replace: true });
    }
  };

  // Handle deleting a conversation from the list
  const handleDeleteConversation = async () => {
    if (!activeConversation) {
      return;
    }

    setPendingChatAction({
      type: "delete-conversation",
      conversationId: activeConversation.id,
    });
  };

  const executeDeleteConversation = async ({ conversationId }) => {
    try {
      const convId = conversationId;

      // Remove from local state
      setConversations((prev) => prev.filter((c) => c.id !== convId));

      // Navigate away
      navigate("/chat");

      setActiveConversation(null);
      setMessages([]);
      return true;
    } catch (error) {
      console.error("Error deleting conversation:", error);
      setError("Failed to delete conversation. Please try again.");
      return false;
    }
  };

  const handleReplyToMessage = useCallback((message) => {
    setReplyingTo({
      id: message.id,
      content: message.content,
      createdAt: message.createdAt || message.created_at,
      senderId: message.senderId || message.sender_id,
      senderUsername: message.senderUsername || message.sender_username,
      senderFirstName:
        message.senderFirstName ||
        message.sender_first_name ||
        message.senderName,
      imageUrl: message.imageUrl || message.image_url,
      fileUrl: message.fileUrl || message.file_url,
      fileName: message.fileName || message.file_name,
      fileSize: message.fileSize || message.file_size,
      fileExpiresAt: message.fileExpiresAt || message.file_expires_at,
      fileDeletedAt: message.fileDeletedAt || message.file_deleted_at,
    });
  }, []);

  const handleClearReply = useCallback(() => {
    setReplyingTo(null);
  }, []);

  const handleSendFile = async (file) => {
    if (!canSendInActiveConversation || !file) {
      if (!isCurrentUserActiveTeamMember) {
        setError("You no longer have access to this team chat.");
      }
      return;
    }

    try {
      // Upload file attachment before sending the message
      const uploadResult = await uploadToImageKit(file, "chatFiles");

      if (!uploadResult.success) {
        setError(uploadResult.error || "Failed to upload file");
        return;
      }

      // Get conversation type and target ID
      const type = searchParams.get("type") || "direct";
      const targetId =
        type === "team"
          ? activeConversation.team?.id
          : activeConversation.partner?.id;

      if (type === "team") {
        const canStillAccess = await refreshActiveTeamMembership(targetId);
        if (!canStillAccess) return;
      }

      // Send message with file via socket
      socketService.sendMessage(
        targetId,
        null,
        type,
        null,
        uploadResult.url,
        file.name,
        replyingTo?.id,
      );
      setReplyingTo(null);
    } catch (error) {
      console.error("Error uploading file:", error);
      setError("Failed to upload file. Please try again.");
    }
  };

  const handleSendImage = async (file) => {
    if (!canSendInActiveConversation || !file) {
      if (!isCurrentUserActiveTeamMember) {
        setError("You no longer have access to this team chat.");
      }
      return;
    }

    try {
      // Upload image attachment before sending the message
      const uploadResult = await uploadToImageKit(file, "chatImages");

      if (!uploadResult.success) {
        setError(uploadResult.error || "Failed to upload image");
        return;
      }

      // Get conversation type and target ID
      const type = searchParams.get("type") || "direct";
      const targetId =
        type === "team"
          ? activeConversation.team?.id
          : activeConversation.partner?.id;

      if (type === "team") {
        const canStillAccess = await refreshActiveTeamMembership(targetId);
        if (!canStillAccess) return;
      }

      // Send message with image via socket
      socketService.sendMessage(
        targetId,
        null,
        type,
        uploadResult.url,
        null,
        file.name,
        replyingTo?.id,
      );
      setReplyingTo(null);
    } catch (error) {
      console.error("Error uploading image:", error);
      setError("Failed to upload image. Please try again.");
    }
  };

  // Delete message (soft delete)
  const handleDeleteMessage = async (messageId) => {
    if (!messageId) return;

    setPendingChatAction({ type: "delete-message", messageId });
  };

  const executeDeleteMessage = async ({ messageId }) => {
    try {
      if ((searchParams.get("type") || "direct") === "team") {
        const canStillAccess = await refreshActiveTeamMembership(conversationId);
        if (!canStillAccess) return false;
      }

      // Optimistic UI update
      setMessages((prev) =>
        prev.map((m) =>
          String(m.id) === String(messageId)
            ? {
                ...m,
                deletedAt: new Date().toISOString(),
                deletedBy: user?.id,
                content: null,
                imageUrl: null,
                fileUrl: null,
                fileName: null,
                fileSize: null,
              }
            : m,
        ),
      );

      await messageService.deleteMessage(messageId);
      return true;
    } catch (err) {
      console.error("Failed to delete message:", err);
      setError("Failed to delete message. Please try again.");

      // Optional: re-fetch messages for correctness after failure
      // (you can leave this out if you don’t want)
      return false;
    }
  };

  const confirmPendingChatAction = async () => {
    if (!pendingChatAction) return;

    try {
      setPendingChatActionLoading(true);

      let actionSucceeded = false;

      if (pendingChatAction.type === "leave-team") {
        actionSucceeded = await executeLeaveTeam(pendingChatAction);
      } else if (pendingChatAction.type === "delete-conversation") {
        actionSucceeded = await executeDeleteConversation(pendingChatAction);
      } else if (pendingChatAction.type === "delete-message") {
        actionSucceeded = await executeDeleteMessage(pendingChatAction);
      }

      if (actionSucceeded) {
        setPendingChatAction(null);
      }
    } finally {
      setPendingChatActionLoading(false);
    }
  };

  const handleEditMessage = async (messageId, content) => {
    if (!messageId) return;

    const trimmedContent = content.trim();
    if (!trimmedContent) {
      throw new Error("Message cannot be empty.");
    }

    if ((searchParams.get("type") || "direct") === "team") {
      const canStillAccess = await refreshActiveTeamMembership(conversationId);
      if (!canStillAccess) return;
    }

    const previousMessage = messages.find(
      (m) => String(m.id) === String(messageId),
    );
    const isLatestMessage =
      messages.length > 0 &&
      String(messages[messages.length - 1]?.id) === String(messageId);
    const editedAt = new Date().toISOString();

    setMessages((prev) =>
      prev.map((m) =>
        String(m.id) === String(messageId)
          ? {
              ...m,
              content: trimmedContent,
              editedAt,
              editedBy: user?.id,
              isEdited: true,
            }
          : m,
      ),
    );

    if (isLatestMessage) {
      setConversations((prev) =>
        prev.map((conversation) =>
          String(conversation.id) === String(conversationId)
            ? {
                ...conversation,
                lastMessage: trimmedContent,
              }
            : conversation,
        ),
      );
    }

    try {
      const response = await messageService.updateMessage(
        messageId,
        trimmedContent,
      );
      const updatedMessage = response?.data || response?.message || response;

      if (updatedMessage && typeof updatedMessage === "object") {
        setMessages((prev) =>
          prev.map((m) =>
            String(m.id) === String(messageId)
              ? {
                  ...m,
                  ...updatedMessage,
                  content: updatedMessage.content ?? trimmedContent,
                  editedAt:
                    updatedMessage.editedAt ||
                    updatedMessage.edited_at ||
                    updatedMessage.updatedAt ||
                    updatedMessage.updated_at ||
                    editedAt,
                  editedBy:
                    updatedMessage.editedBy ??
                    updatedMessage.edited_by ??
                    user?.id,
                  isEdited: true,
                }
              : m,
          ),
        );
      }
    } catch (err) {
      if (previousMessage) {
        setMessages((prev) =>
          prev.map((m) =>
            String(m.id) === String(messageId) ? previousMessage : m,
          ),
        );
      }
      if (isLatestMessage) {
        setConversations((prev) =>
          prev.map((conversation) =>
            String(conversation.id) === String(conversationId)
              ? {
                  ...conversation,
                  lastMessage: previousMessage?.content || conversation.lastMessage,
                }
              : conversation,
          ),
        );
      }
      console.error("Failed to edit message:", err);
      setError("Failed to edit message. Please try again.");
      throw err;
    }
  };

  const handleSendMessage = async (content) => {
    if (!content.trim() || !conversationId) return;
    if (!canSendInActiveConversation) {
      if (!isCurrentUserActiveTeamMember) {
        setError("You no longer have access to this team chat.");
      }
      return;
    }

    // Get type from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const type = urlParams.get("type") || "direct";

    if (type === "team") {
      const canStillAccess = await refreshActiveTeamMembership(conversationId);
      if (!canStillAccess) return;
    }

    // Create optimistic message (show immediately)
    const optimisticMessage = {
      id: `temp-${Date.now()}`,
      senderId: user.id,
      content: content,
      createdAt: new Date().toISOString(),
      senderUsername: user.username,
      type: type,
      isOptimistic: true,
      replyTo: replyingTo,
      replyToId: replyingTo?.id,
    };

    // Add optimistic message to UI immediately
    setMessages((prev) => [...prev, optimisticMessage]);

    // Send message via WebSocket
    socketService.sendMessage(
      conversationId,
      content,
      type,
      null,
      null,
      null,
      replyingTo?.id,
    );
    setReplyingTo(null);

    // Clear typing indicator
    handleTyping(false, type);
  };

  const selectConversation = (id) => {
    // Deselect only when the chat panel is actually open for this conversation.
    // If activeConversation is null and not loading, the panel isn't visible yet
    // (e.g. new virtual conversation) — re-open instead of deselecting.
    if (
      showChatView &&
      String(id) === String(conversationId) &&
      (activeConversation || loadingMessages)
    ) {
      setShowChatView(false);
      navigate("/chat");
      return;
    }

    // Find the conversation to get its type
    const conversation =
      filteredConversations.find((c) => c.id === id) ||
      conversations.find((c) => c.id === id);
    const type = conversation?.type || "direct";

    pendingChatSearchTargetRef.current =
      isChatSearchActive && conversation?.searchMatchMessageId
        ? {
            conversationId: id,
            type,
            messageId: conversation.searchMatchMessageId,
            query: normalizedChatSearchQuery,
          }
        : null;

    // Reset unread count for selected conversation
    setConversations((prev) =>
      prev.map((conv) => (conv.id === id ? { ...conv, unreadCount: 0 } : conv)),
    );

    // Show chat view on mobile/tablet when conversation is selected
    setShowChatView(true);

    // When search is active, reveal the chat panel
    if (isChatSearchActive) {
      revealSearchChat();
    }

    // Navigate with type parameter
    navigate(`/chat/${id}?type=${type}`);
  };

  const pendingChatActionType = pendingChatAction?.type;
  const pendingChatActionConfig = {
    "delete-message": {
      title: "Delete Message",
      message:
        "Delete this message? It will be replaced with a deleted-message marker in this chat.",
      confirmLabel: "Delete",
      loadingLabel: "Deleting...",
      variant: "error",
      icon: <Trash2 size={16} />,
    },
    "delete-conversation": {
      title: "Remove Chat",
      message:
        "Remove this chat from your conversation list? Your message history with this conversation will no longer be shown here.",
      confirmLabel: "Remove",
      loadingLabel: "Removing...",
      variant: "error",
      icon: <Trash2 size={16} />,
    },
    "leave-team": {
      title: "Leave Team Chat",
      message: `Leave "${pendingChatAction?.teamName || "this team"}"? This removes the chat from your conversation list.`,
      confirmLabel: "Leave",
      loadingLabel: "Leaving...",
      variant: "error",
      icon: <LogOut size={16} />,
    },
  }[pendingChatActionType];
  const shouldShowConversationPanel =
    !showEmptyConversationState &&
    !hideChatDuringSearch &&
    Boolean(conversationId) &&
    showChatView &&
    (Boolean(activeConversation) || loadingMessages);
  const chatSearchPlaceholder = "Search chats...";
  const chatSearchInputWidth = `${Math.max(
    chatSearchQuery.length,
    chatSearchPlaceholder.length,
  )}ch`;

  const chatSearchAction = (
    <div className="flex max-w-full flex-col items-start sm:items-end">
      <label className="input input-bordered flex h-10 w-fit max-w-full items-center gap-2 rounded-lg bg-base-100">
        <Search size={16} className="shrink-0 text-base-content/50" />
        <input
          type="search"
          className="min-w-0 text-sm"
          placeholder={chatSearchPlaceholder}
          aria-label="Search chats"
          value={chatSearchQuery}
          onChange={(event) => setChatSearchQuery(event.target.value)}
          style={{
            width: chatSearchInputWidth,
            minWidth: `${chatSearchPlaceholder.length}ch`,
            maxWidth: "min(42vw, 24rem)",
          }}
        />
        {chatSearchQuery && (
          <button
            type="button"
            className="btn btn-ghost btn-xs ml-auto h-6 min-h-0 w-6 p-0"
            onClick={() => setChatSearchQuery("")}
            aria-label="Clear chat search"
          >
            <X size={14} />
          </button>
        )}
      </label>
      {isChatSearchActive && !isNoSearchResults && (
        <p className="mt-1 text-xs text-base-content/60 sm:text-right">
          {filteredConversations.length} of {conversations.length} chats
          {searchingChatMessages
            ? " · searching messages..."
            : ` · ${totalSearchMatches} ${totalSearchMatches === 1 ? "match" : "matches"}`}
        </p>
      )}
    </div>
  );
  return (
    <PageContainer
      title="Chats"
      action={chatSearchAction}
      className="p-0"
      variant="muted"
    >
      <ScreenAlert type="error" message={error} onClose={() => setError(null)} />
      <ScreenAlert
        type="violet"
        message={
          searchNoResultsToastQuery
            ? `No user names, team names, or messages match "${searchNoResultsToastQuery}". Try a different search term.`
            : null
        }
        onClose={() => setSearchNoResultsToastQuery(null)}
      />

      <Modal
        isOpen={Boolean(pendingChatAction)}
        onClose={closePendingChatAction}
        title={pendingChatActionConfig?.title}
        position="center"
        size="small"
        bodyClassName="p-4"
        closeOnBackdrop={!pendingChatActionLoading}
        closeOnEscape={!pendingChatActionLoading}
        showCloseButton={!pendingChatActionLoading}
        footer={
          <div className="flex justify-end gap-3">
            <Button
              variant="ghost"
              onClick={closePendingChatAction}
              disabled={pendingChatActionLoading}
            >
              Cancel
            </Button>
            <Button
              variant={pendingChatActionConfig?.variant || "primary"}
              onClick={confirmPendingChatAction}
              disabled={pendingChatActionLoading}
              icon={pendingChatActionConfig?.icon}
            >
              {pendingChatActionLoading
                ? pendingChatActionConfig?.loadingLabel
                : pendingChatActionConfig?.confirmLabel}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-base-content/80">
          {pendingChatActionConfig?.message}
        </p>
      </Modal>

      <div className="flex h-[calc(100vh-200px)] gap-2">
        {/* Conversation List - Left Sidebar */}
        <div
          data-conversation-list-viewport="true"
          className={`lomir-conversation-list-scrollbar overflow-y-auto transition-all duration-300 ${
            showEmptyConversationState || hideChatDuringSearch || !shouldShowConversationPanel
              ? "w-full"
              : "hidden md:block md:w-1/3"
          }`}
          style={{ direction: "rtl" }}
        >
          <div className="h-full" style={{ direction: "ltr" }}>
            <ConversationList
              conversations={isNoSearchResults ? conversations : filteredConversations}
              activeConversationId={conversationId}
              onSelectConversation={selectConversation}
              loading={loading}
              onlineUsers={onlineUsers}
              onActiveConversationVisibilityChange={
                handleActiveConversationVisibilityChange
              }
              teamMembersRefreshSignal={teamMembersRefreshSignal}
              emptyState={isNoSearchResults ? null : chatSearchEmptyState}
              searchQuery={isNoSearchResults ? "" : chatSearchQuery}
              chatVisible={!hideChatDuringSearch && showChatView}
              currentUser={user}
            />
          </div>
        </div>

        {/* Message Display - Right Side */}
        {shouldShowConversationPanel && (
        <div className={`bg-white shadow-soft rounded-xl overflow-hidden flex flex-col min-w-0 transition-all duration-300 ${
          showChatView ? "w-full md:w-2/3" : "hidden md:flex md:w-2/3"
        }`}>
          {conversationId ? (
            <>
              <ConversationHeader
                showCompactConversationHeader={showCompactConversationHeader}
                onBack={() => setShowChatView(false)}
                conversationType={conversationType}
                teamData={teamData}
                conversationPartner={conversationPartner}
                activeConversation={activeConversation}
                conversationUpdatedAt={conversationUpdatedAt}
                onTeamClick={handleHeaderTeamClick}
                onUserClick={handleHeaderUserClick}
              />

              <div ref={messagesContainerRef} className="flex-grow overflow-y-auto p-4">
                <MessageDisplay
                  messages={visibleMessages}
                  currentUserId={user?.id}
                  conversationPartner={conversationPartner}
                  teamData={teamData}
                  loading={loadingMessages}
                  typingUsers={activeTypingUsers}
                  conversationType={conversationType}
                  teamMembers={teamMembers}
                  highlightMessageIds={highlightMessageIds}
                  hasMoreMessages={hasMoreMessages}
                  loadingMore={loadingMore}
                  teamMembersRefreshSignal={teamMembersRefreshSignal}
                  onLoadEarlierMessages={loadEarlierMessages}
                  onDeleteConversation={handleDeleteConversation}
                  onDeleteMessage={handleDeleteMessage}
                  onEditMessage={handleEditMessage}
                  onLeaveTeam={handleLeaveTeam}
                  onReply={handleReplyToMessage}
                  searchQuery={chatSearchQuery}
                />
              </div>

              {/* Deleted team banner + message input */}
              <div className="border-t border-base-200">
                {/* Show banner for archived teams */}
                {isActiveTeamArchived &&
                  conversationType === "team" &&
                  isCurrentUserActiveTeamMember && (
                  <ArchivedTeamBanner
                    timeRemaining={activeTeamArchiveTimeRemaining}
                    onLeave={() => handleLeaveTeam()}
                  />
                )}

                <div className="p-4">
                  <MessageInput
                    onSendMessage={handleSendMessage}
                    onSendImage={handleSendImage}
                    onSendFile={handleSendFile}
                    onTyping={handleTyping}
                    disabled={!canSendInActiveConversation}
                    participants={mentionParticipants}
                    replyingTo={replyingTo}
                    onClearReply={handleClearReply}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <p className="text-base-content/70">
                Select a conversation to start chatting
              </p>
              <button
                onClick={() => setShowChatView(false)}
                className="md:hidden flex items-center gap-2 btn btn-sm btn-outline"
              >
                <ChevronLeft size={16} />
                Back to conversations
              </button>
            </div>
          )}
        </div>
        )}
      </div>
      <TeamDetailsModal
        isOpen={isTeamModalOpen}
        teamId={selectedTeamId}
        initialTeamData={selectedTeamData}
        hideMatchData
        onLeave={handleTeamDetailsLeave}
        onClose={() => { setIsTeamModalOpen(false); setSelectedTeamId(null); setSelectedTeamData(null); }}
      />

      <UserDetailsModal
        isOpen={isUserModalOpen}
        userId={selectedUserId}
        onClose={() => { setIsUserModalOpen(false); setSelectedUserId(null); }}
      />
    </PageContainer>
  );
};

export default Chat;
