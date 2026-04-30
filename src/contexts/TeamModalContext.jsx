import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";
import TeamDetailsModal from "../components/teams/TeamDetailsModal";
import { ModalLayerProvider, MODAL_Z_STEP } from "./ModalLayerContext";

const TeamModalContext = createContext(null);
const BASE_Z_INDEX = 1000;

export const useTeamModal = () => {
  const ctx = useContext(TeamModalContext);
  if (!ctx) {
    throw new Error("useTeamModal must be used within a TeamModalProvider");
  }
  return ctx;
};

export const useTeamModalSafe = () => useContext(TeamModalContext);

export const TeamModalProvider = ({ children }) => {
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [isOpen, setIsOpen] = useState(false);

  const openTeamModal = useCallback((teamId, teamName, options = {}) => {
    if (!teamId) return;
    const requestedZIndex = Number(options?.zIndex);
    const modalZIndex = Number.isFinite(requestedZIndex)
      ? Math.max(BASE_Z_INDEX, requestedZIndex)
      : BASE_Z_INDEX;

    setSelectedTeam({
      id: teamId,
      name: teamName,
      zIndex: modalZIndex,
      initialTeamData: options?.initialTeamData ?? null,
      isFromSearch: Boolean(options?.isFromSearch),
      showMatchHighlights: Boolean(options?.showMatchHighlights),
      roleMatchBadgeNames: options?.roleMatchBadgeNames ?? null,
      matchScore: options?.matchScore ?? null,
      matchType: options?.matchType ?? null,
      matchDetails: options?.matchDetails ?? null,
    });
    setIsOpen(true);
  }, []);

  const closeTeamModal = useCallback(() => {
    setIsOpen(false);
    setSelectedTeam(null);
  }, []);

  const value = useMemo(
    () => ({
      openTeamModal,
      closeTeamModal,
      isTeamModalOpen: isOpen,
      selectedTeam,
    }),
    [closeTeamModal, isOpen, openTeamModal, selectedTeam],
  );

  const modalZIndex = selectedTeam?.zIndex ?? BASE_Z_INDEX;

  return (
    <TeamModalContext.Provider value={value}>
      {children}

      {isOpen &&
        selectedTeam &&
        createPortal(
          <ModalLayerProvider zIndex={modalZIndex + MODAL_Z_STEP}>
            <TeamDetailsModal
              isOpen={true}
              teamId={selectedTeam.id}
              initialTeamData={{
                ...(selectedTeam.initialTeamData ?? {}),
                id: selectedTeam.initialTeamData?.id ?? selectedTeam.id,
                name: selectedTeam.initialTeamData?.name ?? selectedTeam.name,
              }}
              onClose={closeTeamModal}
              isFromSearch={selectedTeam.isFromSearch}
              showMatchHighlights={selectedTeam.showMatchHighlights}
              roleMatchBadgeNames={selectedTeam.roleMatchBadgeNames}
              matchScore={selectedTeam.matchScore}
              matchType={selectedTeam.matchType}
              matchDetails={selectedTeam.matchDetails}
              zIndexStyle={{ zIndex: modalZIndex }}
              boxZIndexStyle={{ zIndex: modalZIndex + 1 }}
            />
          </ModalLayerProvider>,
          document.body,
        )}
    </TeamModalContext.Provider>
  );
};
