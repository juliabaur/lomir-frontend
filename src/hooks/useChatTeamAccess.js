import { useCallback, useEffect } from "react";
import { fetchTeamById } from "./useTeamQueries";
import { messageService } from "../services/messageService";
import socketService from "../services/socketService";
import {
  isUserTeamMember,
  mergeTeamDetailsIntoConversationData,
  isArchivedTeamData,
} from "../utils/chatHelpers";

// Team-chat access + membership helpers extracted from Chat.jsx (Stage 5a).
// Owns team-details fetching, access revocation, live membership refresh, and
// conversation hydration. These helpers are consumed both here (send/edit/delete
// handlers) and by useActiveChatConversation / useChatSocketEvents, so keeping
// them in one hook untangles the previous Chat.jsx -> hooks prop wiring.
const useChatTeamAccess = ({
  queryClient,
  user,
  conversationId,
  conversationType,
  activeConversation,
  searchParams,
  navigate,
  activeConversationRef,
  clearTypingUsers,
  setError,
  setConversations,
  setActiveConversation,
  setMessages,
  setReplyingTo,
  setHighlightMessageIds,
  setHasMoreMessages,
  setShowChatView,
  setIsTeamArchived,
  setLoadingMessages,
}) => {
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
      activeConversationRef,
      clearTypingUsers,
      conversationId,
      navigate,
      searchParams,
      setActiveConversation,
      setConversations,
      setError,
      setHasMoreMessages,
      setHighlightMessageIds,
      setMessages,
      setReplyingTo,
      setShowChatView,
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
    [fetchTeamDetails, revokeTeamChatAccess, setActiveConversation, user?.id],
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
    [
      fetchTeamDetails,
      revokeTeamChatAccess,
      setIsTeamArchived,
      setLoadingMessages,
      user?.id,
    ],
  );

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

  return {
    revokeTeamChatAccess,
    refreshActiveTeamMembership,
    hydrateTeamConversationDetails,
  };
};

export default useChatTeamAccess;
