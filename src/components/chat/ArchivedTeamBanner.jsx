import { Archive, LogOut } from "lucide-react";

// Farewell banner shown inside an archived team's chat during the deletion
// grace window, for remaining members. Presentational — the parent gates
// visibility and passes the remaining-time label and the leave handler.
const ArchivedTeamBanner = ({ timeRemaining, onLeave }) => {
  return (
                  <div
                    className="flex flex-col items-center gap-3 px-5 py-4 mx-4 mt-4 rounded-2xl text-center"
                    style={{
                      backgroundColor: "rgba(239, 68, 68, 0.1)",
                      color: "#dc2626",
                    }}
                  >
                    <Archive size={18} className="shrink-0" />
                    <div className="inline-flex max-w-full rounded-md bg-red-500/10 px-3 py-2 text-sm font-medium text-red-600">
                      <span>
                        This team has been archived and is scheduled for
                        deletion. The chat stays available for{" "}
                        {timeRemaining || "up to 14 days"} so
                        remaining teammates can say goodbye. Leave anytime; once
                        you leave or the chat is deleted, its messages and files
                        are no longer accessible.
                      </span>
                    </div>

                    <button
                      onClick={onLeave}
                      className="flex items-center gap-1 text-xs text-red-600 underline opacity-80 transition-opacity hover:opacity-100 hover:no-underline cursor-pointer"
                    >
                      <LogOut size={14} />
                      Leave team chat now
                    </button>
                  </div>
  );
};

export default ArchivedTeamBanner;
